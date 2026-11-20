use super::prompt::{
    AssistantGuidance, compose_guidance_prompt, contextual_prompt, selected_text_prompt,
    validate_prompt,
};
use super::selection::SessionReuse;
use super::selection::validate_runtime_options;
use super::session::close_owned_transport;
use crate::agent::error::AgentError;
use crate::agent::*;
use std::{sync::atomic::Ordering, time::Duration};

pub(super) struct TurnRequest {
    pub text: String,
    pub cwd: String,
    pub provider: String,
    pub selection: ModelSelection,
    pub capture: Option<CapturedImage>,
    pub selected_text: Option<String>,
    pub guidance: AssistantGuidance,
    pub truncate_messages_to: Option<usize>,
    pub consume_staged: bool,
}

impl AgentRuntime {
    #[cfg(test)]
    pub(crate) fn persist_prompt(&self, run_id: u64, text: &str) -> Result<(), AgentError> {
        self.persist_prompt_at(run_id, text, None)
    }

    pub(crate) fn persist_prompt_at(
        &self,
        run_id: u64,
        text: &str,
        truncate_to: Option<usize>,
    ) -> Result<(), AgentError> {
        let mut snapshot = self.snapshot();
        if let Some(index) = truncate_to {
            snapshot.messages.truncate(index);
        }
        let pending = ChatMessage {
            id: format!("{run_id}:user"),
            role: "user".into(),
            text: text.to_owned(),
        };
        if !snapshot
            .messages
            .iter()
            .any(|message| message.id == pending.id)
        {
            snapshot.messages.push(pending.clone());
        }
        self.conversation.persist_snapshot(&snapshot, true)?;
        mutate(&self.updates, |state| {
            if state.run_id == run_id {
                if let Some(index) = truncate_to {
                    state.messages.truncate(index);
                }
                if !state
                    .messages
                    .iter()
                    .any(|message| message.id == pending.id)
                {
                    state.messages.push(pending);
                }
            }
        });
        Ok(())
    }

    pub(crate) fn persist_current_snapshot(&self, interrupted: bool) -> Result<(), AgentError> {
        self.conversation
            .persist_snapshot(&self.snapshot(), interrupted)
    }

    pub(crate) fn fail_starting_run<T>(
        &self,
        run_id: u64,
        error: &AgentError,
    ) -> Result<T, String> {
        let marker_failed = self
            .recovery
            .as_ref()
            .is_some_and(|marker| marker.clear_if(run_id).is_err());
        let message = append_notice(&error.to_string(), marker_failed);
        mutate(&self.updates, |state| {
            if state.run_id == run_id && state.status == RunPhase::Starting {
                state.status = RunPhase::Failed;
                state.error = Some(message.clone());
                let staged = state.capture.staged.take();
                state.capture = CaptureSnapshot {
                    staged,
                    ..CaptureSnapshot::default()
                };
            }
        });
        Err(message)
    }

    pub(super) async fn ask_with_context(
        &self,
        request: TurnRequest,
    ) -> Result<AcceptedRun, String> {
        let TurnRequest {
            text,
            cwd,
            provider,
            selection,
            capture,
            selected_text,
            guidance,
            truncate_messages_to,
            consume_staged,
        } = request;
        let ModelSelection {
            model,
            thinking_effort,
        } = selection;
        let text = validate_prompt(&text)?;
        let selected = ProviderId::parse(&provider).ok_or("Selected provider is unavailable.")?;
        let staged_meta = (consume_staged && capture.is_none() && selected_text.is_none())
            .then(|| self.peek_staged_capture_meta())
            .flatten();
        let has_image = capture.is_some() || staged_meta.is_some_and(|(_, is_image)| is_image);
        let staged_selected_text = staged_meta
            .filter(|(_, is_image)| !*is_image)
            .and_then(|(id, _)| self.peek_staged_selected_text(id));
        let effective_selected_text = selected_text.or(staged_selected_text);
        selected.validate(has_image)?;
        let capture_origin = has_image || effective_selected_text.is_some();
        let cwd = std::fs::canonicalize(resolve_workspace_path(&cwd))
            .map_err(|_| "Working folder does not exist.".to_string())?;
        if !cwd.is_dir() {
            return Err("Working context must be a folder.".into());
        }
        let mut guard = self.control.lock().await;
        let current = self.snapshot();
        if matches!(
            current.status,
            RunPhase::Starting | RunPhase::Streaming | RunPhase::Stopping
        ) {
            return Err("An answer is already running.".into());
        }
        if current.capture.phase != "idle" && !capture_origin {
            return Err(
                "Finish or cancel the current screen capture before asking a question.".into(),
            );
        }
        if capture_origin && !matches!(current.capture.phase.as_str(), "idle" | "submitting") {
            return Err("The screen capture is no longer ready to submit.".into());
        }
        if current.provider != selected {
            return Err(
                "Select the provider in Agent Settings before requesting an answer.".into(),
            );
        }
        if guard.as_ref().is_some_and(|tx| !tx.is_closed())
            && std::path::Path::new(&current.cwd) != cwd.as_path()
        {
            return Err(
                "Working context is fixed for this conversation. Restart Otto to change it.".into(),
            );
        }
        if current.status == RunPhase::Completed {
            self.persist_current_snapshot(false).map_err(String::from)?;
        }

        if truncate_messages_to.is_some_and(|index| index > current.messages.len()) {
            return Err("Selected prompt is no longer in this conversation.".into());
        }
        let ephemeral = effective_selected_text.is_some();
        let force_reset = ephemeral || truncate_messages_to.is_some();
        if force_reset && let Some(sender) = guard.as_ref().filter(|tx| !tx.is_closed()) {
            close_owned_transport(sender, Duration::from_secs(5)).await?;
            *guard = None;
        }
        if truncate_messages_to.is_some() {
            self.clear_session_guidance();
        }
        let provider_has_context = !force_reset
            && guard.as_ref().is_some_and(|sender| !sender.is_closed())
            && current.thread_id.is_some();
        let reusable_followup = !force_reset
            && guard.as_ref().is_some_and(|sender| !sender.is_closed())
            && selected.can_reuse_without_probe(&SessionReuse::for_turn(
                &current,
                &cwd,
                model.as_deref(),
                thinking_effort.as_deref(),
                has_image,
            ));
        let include_guidance = self.should_include_guidance(&guidance, provider_has_context);
        let prior_messages = truncate_messages_to
            .map(|index| &current.messages[..index])
            .unwrap_or(&current.messages);
        let provider_text = if provider_has_context || effective_selected_text.is_some() {
            text.clone()
        } else {
            contextual_prompt(prior_messages, &text)
        };
        let provider_text = effective_selected_text
            .as_deref()
            .map(|selected| selected_text_prompt(&provider_text, selected))
            .unwrap_or(provider_text);
        let provider_text = compose_guidance_prompt(&provider_text, &guidance, include_guidance);
        let reserved_run_id = if reusable_followup {
            None
        } else {
            let run_id = self.next_run_id.fetch_add(1, Ordering::Relaxed) + 1;
            if let Some(marker) = &self.recovery {
                marker.mark(run_id)?;
            }
            let cancelled = self.begin_run_readiness()?;
            mutate(&self.updates, |s| {
                s.run_id = run_id;
                s.status = RunPhase::Starting;
                s.activity.clear();
                s.provider = selected;
                s.capture.phase = if capture_origin { "analyzing" } else { "idle" }.into();
                s.capture.error = None;
                s.error = None;
                s.cwd = cwd.to_string_lossy().into_owned();
                if !provider_has_context {
                    s.thread_id = None;
                }
                s.model = model.clone();
                s.thinking_effort = thinking_effort.clone();
                s.usage = None;
            });
            drop(guard);
            let requested_cwd = cwd.to_string_lossy().into_owned();
            let readiness = tokio::select! {
                _ = cancelled => Err(AgentError::cancelled("Readiness probe cancelled.")),
                readiness = self.provider_readiness_for(
                    selected.as_str(),
                    Some(&requested_cwd),
                    model.as_deref(),
                ) => Ok(readiness),
            };
            guard = self.control.lock().await;
            self.finish_run_readiness();
            let latest = self.snapshot();
            if latest.run_id != run_id || latest.status != RunPhase::Starting {
                return Err("Agent readiness was stopped or superseded.".into());
            }
            let readiness = match readiness {
                Ok(readiness) => readiness,
                Err(error) => {
                    return self.fail_starting_run(run_id, &error);
                }
            };
            if readiness.status != "ready" {
                return self.fail_starting_run(
                    run_id,
                    &AgentError::readiness_failed(format!(
                        "{} {}",
                        readiness.message, readiness.recovery
                    )),
                );
            }
            if has_image && !readiness.image_input {
                return self.fail_starting_run(
                    run_id,
                    &AgentError::invalid_request(
                        "The selected provider model cannot accept an image.",
                    ),
                );
            }
            if let Err(error) =
                validate_runtime_options(&readiness, model.as_deref(), thinking_effort.as_deref())
            {
                return self.fail_starting_run(run_id, &AgentError::invalid_request(error));
            }
            if selected.capabilities().pending_model_selection {
                *self.selected_runtime.lock().unwrap() = ModelSelection {
                    model: model.clone(),
                    thinking_effort: thinking_effort.clone(),
                };
            }
            if !readiness.rate_limits.is_empty() {
                let rate_limits = readiness.rate_limits;
                mutate(&self.updates, |state| {
                    if state.run_id == run_id {
                        state.rate_limits = rate_limits;
                    }
                });
            }
            Some(run_id)
        };
        if let Some(sender) = guard.as_ref().filter(|tx| !tx.is_closed()) {
            let run_id = reserved_run_id
                .unwrap_or_else(|| self.next_run_id.fetch_add(1, Ordering::Relaxed) + 1);
            let fail = |reason: &str| {
                if reserved_run_id.is_some() {
                    self.fail_starting_run(run_id, &AgentError::invalid_request(reason))
                } else {
                    Err(reason.to_owned())
                }
            };
            if std::path::Path::new(&current.cwd) != cwd.as_path() {
                return fail(
                    "Working context is fixed for this conversation. Restart Otto to change it.",
                );
            }
            if current.provider != selected {
                return fail("Provider is fixed for the conversation. Start a new session.");
            }
            let Ok(permit) = sender.try_reserve() else {
                return fail("Agent provider is busy. Try again.");
            };
            if reserved_run_id.is_none()
                && let Some(marker) = &self.recovery
            {
                marker.mark(run_id)?;
            }
            if selected.capabilities().pending_model_selection {
                *self.selected_runtime.lock().unwrap() = ModelSelection {
                    model: model.clone(),
                    thinking_effort: thinking_effort.clone(),
                };
            }
            mutate(&self.updates, |s| {
                s.run_id = run_id;
                s.status = RunPhase::Starting;
                s.activity.clear();
                s.capture.phase = if capture_origin { "analyzing" } else { "idle" }.into();
                s.capture.error = None;
                s.error = None;
                s.model = model.clone();
                s.thinking_effort = thinking_effort.clone();
                s.usage = None;
            });
            if let Err(error) = self.persist_prompt_at(run_id, &text, truncate_messages_to) {
                return self.fail_starting_run(run_id, &error);
            }
            let capture = self.consume_turn_capture(capture, staged_meta);
            permit.send(Control::Ask {
                text: provider_text,
                display_text: text,
                cwd,
                run_id,
                model,
                thinking_effort,
                capture,
            });
            self.record_session_guidance(&guidance, ephemeral);
            return Ok(AcceptedRun { run_id });
        }
        let run_id = reserved_run_id.ok_or("Agent run reservation is missing.")?;
        if let Err(error) = self.persist_prompt_at(run_id, &text, truncate_messages_to) {
            return self.fail_starting_run(run_id, &error);
        }
        let capture = self.consume_turn_capture(capture, staged_meta);
        let initial = Control::Ask {
            text: provider_text,
            display_text: text,
            cwd,
            run_id,
            model,
            thinking_effort,
            capture,
        };
        let tx =
            super::session::spawn_provider_run(selected, self.updates.clone(), initial, ephemeral);
        *guard = Some(tx);
        self.record_session_guidance(&guidance, ephemeral);
        Ok(AcceptedRun { run_id })
    }

    pub async fn stop(&self) -> Result<(), String> {
        let guard = self.control.lock().await;
        let status = self.snapshot().status;
        if status == RunPhase::Stopping {
            return Ok(());
        }
        if !matches!(status, RunPhase::Starting | RunPhase::Streaming) {
            return Err("No active agent turn.".into());
        }
        self.drop_queued_followup();
        if status == RunPhase::Starting && self.cancel_run_readiness() {
            let run_id = self.snapshot().run_id;
            let clear_failed = self
                .recovery
                .as_ref()
                .is_some_and(|marker| marker.clear_if(run_id).is_err());
            mutate(&self.updates, |state| {
                if state.run_id == run_id && state.status == RunPhase::Starting {
                    state.status = RunPhase::Stopped;
                    state.capture = CaptureSnapshot::default();
                    if clear_failed {
                        state.error = Some(MARKER_CLEAR_NOTICE.into());
                    }
                }
            });
            return Ok(());
        }
        let sender = guard.as_ref().ok_or("No active agent process.")?;
        let permit = sender
            .try_reserve()
            .map_err(|_| "Agent is busy; retry Stop.".to_string())?;

        mutate(&self.updates, |s| {
            if matches!(s.status, RunPhase::Starting | RunPhase::Streaming) {
                s.status = RunPhase::Stopping;
                s.pending_permission = None;
            }
        });
        permit.send(Control::Stop);
        Ok(())
    }
}

fn append_notice(message: &str, marker_failed: bool) -> String {
    if marker_failed {
        format!("{message} {MARKER_CLEAR_NOTICE}")
    } else {
        message.to_owned()
    }
}

#[cfg(test)]
pub(crate) use super::recovery::persist_terminal_outcome;
