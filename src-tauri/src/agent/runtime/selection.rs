use super::cache::CacheHit;
use super::session::close_owned_transport;
use crate::agent::conversation as history;
use crate::agent::*;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::Duration;

pub(crate) struct SessionReuse<'a> {
    pub provider: ProviderId,
    pub status: RunPhase,
    pub thread_id: Option<&'a str>,
    pub current_cwd: &'a Path,
    pub requested_cwd: &'a Path,
    pub current_model: Option<&'a str>,
    pub current_thinking_effort: Option<&'a str>,
    pub model: Option<&'a str>,
    pub thinking_effort: Option<&'a str>,
    pub has_capture: bool,
}

impl<'a> SessionReuse<'a> {
    pub fn for_turn(
        snapshot: &'a Snapshot,
        requested_cwd: &'a Path,
        model: Option<&'a str>,
        thinking_effort: Option<&'a str>,
        has_capture: bool,
    ) -> Self {
        Self {
            provider: snapshot.provider,
            status: snapshot.status,
            thread_id: snapshot.thread_id.as_deref(),
            current_cwd: Path::new(&snapshot.cwd),
            requested_cwd,
            current_model: snapshot.model.as_deref(),
            current_thinking_effort: snapshot.thinking_effort.as_deref(),
            model,
            thinking_effort,
            has_capture,
        }
    }
}

impl AgentRuntime {
    pub fn provider_catalog(&self) -> Vec<ProviderDescriptor> {
        ProviderId::catalog()
    }

    pub fn refresh_provider_catalog(&self) -> Vec<ProviderDescriptor> {
        crate::agent::providers::refresh_live_path();
        self.readiness_cache.invalidate_all();
        ProviderId::catalog()
    }

    pub fn runtime_prefs(&self) -> RuntimePrefs {
        self.prefs.snapshot()
    }

    pub fn toggle_pinned_model(
        &self,
        provider: String,
        model_id: String,
    ) -> Result<Vec<String>, String> {
        let provider = ProviderId::parse(&provider).ok_or("Unknown provider.")?;
        Ok(self.prefs.toggle_pinned_model(provider, &model_id))
    }

    pub async fn select_provider(&self, provider: String) -> Result<(), String> {
        self.select_provider_with_timeout(provider, Duration::from_secs(5))
            .await
    }

    pub(crate) async fn select_provider_with_timeout(
        &self,
        provider: String,
        close_timeout: Duration,
    ) -> Result<(), String> {
        let provider = ProviderId::parse(&provider).ok_or("Unknown provider.")?;
        let mut guard = self.control.lock().await;
        let current = self.snapshot();
        if matches!(
            current.status,
            RunPhase::Starting | RunPhase::Streaming | RunPhase::Stopping
        ) || current.capture.phase != "idle"
        {
            return Err(
                "Finish or Stop the current answer or capture before changing provider.".into(),
            );
        }
        if current.provider == provider {
            return Ok(());
        }
        if let Some(sender) = guard.as_ref().filter(|sender| !sender.is_closed()) {
            close_owned_transport(sender, close_timeout).await?;
        }
        let latest = self.snapshot();
        if latest.capture.request_id != current.capture.request_id || latest.capture.phase != "idle"
        {
            *guard = None;
            mutate(&self.updates, |state| state.thread_id = None);
            return Err(
                "Screen capture started while changing provider. Retry after capture.".into(),
            );
        }

        let id_guard = self
            .conversation
            .id
            .lock()
            .map_err(|_| "Conversation history is unavailable.".to_string())?;
        let id = id_guard.clone();
        let mut switched = current.clone();
        switched.conversation_id = id.clone();
        switched.provider = provider;
        switched.thread_id = None;
        switched.model = None;
        switched.thinking_effort = None;
        switched.usage = None;
        switched.rate_limits.clear();
        switched.error = None;
        if let Some(record) =
            history::record_from_snapshot(&id, &switched, current.status != RunPhase::Completed)
            && let Err(error) = self.conversation.history.upsert(record)
        {
            *guard = None;
            mutate(&self.updates, |state| {
                state.thread_id = None;
                state.error = Some(
                        "Conversation history could not be saved. The previous provider session was closed."
                            .into(),
                    );
            });
            return Err(String::from(error));
        }

        *guard = None;
        let (saved_model, saved_effort) = self.prefs.set_provider(provider);
        let cached_limits = self.readiness_cache.rate_limits_cached(provider);
        *self.selected_runtime.lock().unwrap() = ModelSelection {
            model: saved_model.clone(),
            thinking_effort: saved_effort.clone(),
        };
        self.clear_session_guidance();
        self.clear_staged_image_if_unsupported(provider);
        self.next_run_id
            .fetch_max(current.run_id, Ordering::Relaxed);
        let next_run_id = self.next_run_id.fetch_add(1, Ordering::Relaxed) + 1;
        let marker_failed = self
            .recovery
            .as_ref()
            .is_some_and(|marker| marker.clear_if(current.run_id).is_err());
        mutate(&self.updates, |state| {
            if state.run_id == current.run_id {
                state.run_id = next_run_id;
                state.conversation_id = id;
                state.provider = provider;
                state.thread_id = None;
                state.model = saved_model;
                state.thinking_effort = saved_effort;
                state.usage = None;
                state.rate_limits = cached_limits;
                state.turn_timing = None;
                state.error = marker_failed.then(|| MARKER_CLEAR_NOTICE.into());
            }
        });
        drop(id_guard);
        Ok(())
    }

    pub async fn select_runtime_options(
        &self,
        model: Option<String>,
        thinking_effort: Option<String>,
    ) -> Result<(), String> {
        let guard = self.control.lock().await;
        let current = self.snapshot();
        if matches!(
            current.status,
            RunPhase::Starting | RunPhase::Streaming | RunPhase::Stopping
        ) || current.capture.phase != "idle"
        {
            return Err("Finish the current request or capture before changing the model.".into());
        }
        let selection_id = self
            .next_runtime_selection_id
            .fetch_add(1, Ordering::Relaxed)
            + 1;
        let cached = self.cached_readiness_for(current.provider, model.as_deref());
        let needs_live_probe = matches!(cached, CacheHit::Miss)
            && current.provider.capabilities().pending_model_selection;
        let cached_readiness = match cached {
            CacheHit::Fresh(ready) | CacheHit::Stale(ready) => Some(ready),
            CacheHit::Miss => None,
        };
        drop(guard);
        let validated = if let Some(ready) = cached_readiness {
            Some(ready)
        } else if needs_live_probe {
            Some(
                self.provider_readiness_for(
                    current.provider.as_str(),
                    Some(&current.cwd),
                    model.as_deref(),
                )
                .await,
            )
        } else {
            None
        };
        let _guard = self.control.lock().await;
        let latest = self.snapshot();
        if !runtime_selection_still_current(
            &current,
            &latest,
            selection_id,
            self.next_runtime_selection_id.load(Ordering::Relaxed),
        ) {
            return Err("Runtime selection changed while readiness was checked. Retry.".into());
        }
        if let Some(readiness) = validated {
            if readiness.status != "ready" {
                return Err(format!("{} {}", readiness.message, readiness.recovery));
            }
            validate_runtime_options(&readiness, model.as_deref(), thinking_effort.as_deref())?;
        }
        self.prefs.set_selection(
            current.provider,
            model.as_deref(),
            thinking_effort.as_deref(),
        );
        *self.selected_runtime.lock().unwrap() = ModelSelection {
            model: model.clone(),
            thinking_effort: thinking_effort.clone(),
        };
        if latest.status == RunPhase::Idle && latest.messages.is_empty() {
            mutate(&self.updates, |state| {
                if state.run_id == latest.run_id
                    && state.status == RunPhase::Idle
                    && state.messages.is_empty()
                {
                    state.model = model;
                    state.thinking_effort = thinking_effort;
                }
            });
        }
        Ok(())
    }

    pub(crate) fn capture_runtime_options(&self, state: &Snapshot) -> ModelSelection {
        let previous = ModelSelection {
            model: state.model.clone(),
            thinking_effort: state.thinking_effort.clone(),
        };
        state
            .provider
            .options_for_capture(&previous, &self.selected_runtime.lock().unwrap())
    }
}

pub(crate) fn runtime_selection_still_current(
    previous: &Snapshot,
    latest: &Snapshot,
    selection_id: u64,
    newest_selection_id: u64,
) -> bool {
    selection_id == newest_selection_id
        && latest.run_id == previous.run_id
        && latest.provider == previous.provider
        && latest.conversation_id == previous.conversation_id
        && latest.cwd == previous.cwd
        && latest.status == previous.status
        && latest.capture.request_id == previous.capture.request_id
        && latest.capture.phase == "idle"
}

pub(crate) fn validate_runtime_options(
    readiness: &ProviderReadiness,
    model: Option<&str>,
    thinking_effort: Option<&str>,
) -> Result<(), String> {
    if let Some(model) = model {
        let selected = readiness
            .models
            .iter()
            .find(|option| option.id == model)
            .ok_or("Selected model is not available from the provider catalog.")?;
        if let Some(effort) = thinking_effort
            && !selected
                .thinking_efforts
                .iter()
                .any(|value| value == effort)
        {
            return Err("Selected thinking effort is not supported by the model.".into());
        }
    } else if let Some(effort) = thinking_effort
        && !readiness
            .thinking_efforts
            .iter()
            .any(|value| value == effort)
    {
        return Err("Selected thinking effort is not supported by the provider.".into());
    }
    Ok(())
}
