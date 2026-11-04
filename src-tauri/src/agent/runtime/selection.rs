use super::run::close_owned_transport;
use crate::agent::*;
use std::sync::atomic::Ordering;
use std::time::Duration;

impl AgentRuntime {
    pub fn provider_installed(&self, provider: &str) -> bool {
        ProviderId::parse(provider).is_some_and(ProviderId::is_installed)
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
        *self.selected_runtime.lock().unwrap() = ModelSelection::default();
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
                state.model = None;
                state.thinking_effort = None;
                state.usage = None;
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
        if !current.provider.capabilities().pending_model_selection {
            return Err("Pi runtime selection requires the Pi provider.".into());
        }
        if matches!(
            current.status,
            RunPhase::Starting | RunPhase::Streaming | RunPhase::Stopping
        ) || current.capture.phase != "idle"
        {
            return Err(
                "Finish the current request or capture before changing the Pi model.".into(),
            );
        }
        let selection_id = self
            .next_runtime_selection_id
            .fetch_add(1, Ordering::Relaxed)
            + 1;
        drop(guard);
        let readiness = self
            .provider_readiness_for(
                current.provider.as_str(),
                Some(&current.cwd),
                model.as_deref(),
            )
            .await;
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
        if readiness.status != "ready" {
            return Err(format!("{} {}", readiness.message, readiness.recovery));
        }
        validate_runtime_options(&readiness, model.as_deref(), thinking_effort.as_deref())?;
        *self.selected_runtime.lock().unwrap() = ModelSelection {
            model,
            thinking_effort,
        };
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
