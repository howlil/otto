use super::SessionReuse;
use super::selection::validate_runtime_options;
use crate::agent::error::AgentError;
use crate::agent::*;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::timeout;

impl AgentRuntime {
    pub(crate) fn persist_prompt(&self, run_id: u64, text: &str) -> Result<(), AgentError> {
        let mut snapshot = self.snapshot();
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
            if state.run_id == run_id
                && !state
                    .messages
                    .iter()
                    .any(|message| message.id == pending.id)
            {
                state.messages.push(pending);
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
                state.capture = CaptureSnapshot::default();
            }
        });
        Err(message)
    }

    pub async fn ask(
        &self,
        text: String,
        provider: String,
        model: Option<String>,
        thinking_effort: Option<String>,
    ) -> Result<AcceptedRun, String> {
        self.ask_with_capture(
            text,
            default_workspace_path().to_string_lossy().into_owned(),
            provider,
            ModelSelection {
                model,
                thinking_effort,
            },
            None,
        )
        .await
    }

    pub(crate) async fn ask_with_capture(
        &self,
        text: String,
        cwd: String,
        provider: String,
        selection: ModelSelection,
        capture: Option<CapturedImage>,
    ) -> Result<AcceptedRun, String> {
        let ModelSelection {
            model,
            thinking_effort,
        } = selection;
        let text = validate_prompt(&text)?;
        let selected = ProviderId::parse(&provider).ok_or("Selected provider is unavailable.")?;
        selected.validate(capture.is_some())?;
        let capture_origin = capture.is_some();
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
        if current.status == RunPhase::Completed {
            self.persist_current_snapshot(false).map_err(String::from)?;
        }

        let provider_has_context =
            guard.as_ref().is_some_and(|sender| !sender.is_closed()) && current.thread_id.is_some();
        let reusable_followup = guard.as_ref().is_some_and(|sender| !sender.is_closed())
            && selected.can_reuse_without_probe(&SessionReuse::for_turn(
                &current,
                &cwd,
                model.as_deref(),
                thinking_effort.as_deref(),
                capture.is_some(),
            ));
        let provider_text = if provider_has_context {
            text.clone()
        } else {
            contextual_prompt(&current.messages, &text)
        };
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
            if !readiness.tool_free_admission {
                return self.fail_starting_run(
                    run_id,
                    &AgentError::readiness_failed(
                        "The selected provider cannot confirm a tool-free chat session.",
                    ),
                );
            }
            if capture.is_some() && !readiness.image_input {
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
            Some(run_id)
        };
        if let Some(sender) = guard.as_ref().filter(|tx| !tx.is_closed()) {
            if std::path::Path::new(&current.cwd) != cwd.as_path() {
                return Err(
                    "Working context is fixed for this conversation. Restart Otto to change it."
                        .into(),
                );
            }

            if current.provider != selected {
                return Err("Provider is fixed for the conversation. Start a new session.".into());
            }
            let run_id = self.next_run_id.fetch_add(1, Ordering::Relaxed) + 1;
            let permit = sender
                .try_reserve()
                .map_err(|_| "Agent provider is busy. Try again.".to_string())?;

            if let Some(marker) = &self.recovery {
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
                s.capture.phase = if capture_origin { "analyzing" } else { "idle" }.into();
                s.capture.error = None;
                s.error = None;
                s.model = model.clone();
                s.thinking_effort = thinking_effort.clone();
                s.usage = None;
            });
            if let Err(error) = self.persist_prompt(run_id, &text) {
                return self.fail_starting_run(run_id, &error);
            }
            permit.send(Control::Ask {
                text: provider_text,
                display_text: text,
                cwd,
                run_id,
                model,
                thinking_effort,
                capture,
            });
            return Ok(AcceptedRun { run_id });
        }
        let run_id = reserved_run_id.ok_or("Agent run reservation is missing.")?;
        if let Err(error) = self.persist_prompt(run_id, &text) {
            return self.fail_starting_run(run_id, &error);
        }
        let (tx, rx) = mpsc::channel(4);
        let events = events::ProviderEvents::new(self.updates.clone());
        tauri::async_runtime::spawn(async move {
            let initial = Control::Ask {
                text: provider_text,
                display_text: text,
                cwd,
                run_id,
                model,
                thinking_effort,
                capture,
            };
            selected.run(rx, events, initial).await;
        });
        *guard = Some(tx);
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
        if status == RunPhase::Starting && guard.is_none() && self.cancel_run_readiness() {
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
            }
        });
        permit.send(Control::Stop);
        Ok(())
    }
}

pub(crate) const MAX_PROMPT_BYTES: usize = 12_000;

fn append_notice(message: &str, marker_failed: bool) -> String {
    if marker_failed {
        format!("{message} {MARKER_CLEAR_NOTICE}")
    } else {
        message.to_owned()
    }
}

pub(super) async fn close_owned_transport(
    sender: &mpsc::Sender<Control>,
    close_timeout: Duration,
) -> Result<(), String> {
    let (finished, mut closed) = oneshot::channel();
    let claimed = Arc::new(AtomicBool::new(false));
    sender
        .try_send(Control::Close {
            claimed: Arc::clone(&claimed),
            finished,
        })
        .map_err(|_| "Agent provider is busy. Try again.".to_string())?;
    match timeout(close_timeout, &mut closed).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(_)) => Err("Agent closed unexpectedly; session was not reset.".into()),
        Err(_) if !claimed.swap(true, Ordering::SeqCst) => {
            Err("Agent did not accept session close; session was not reset.".into())
        }
        Err(_) => Err("Agent is still closing; session was not reset.".into()),
    }
}

pub(crate) fn persist_terminal_outcome(
    conversation: &conversation::ConversationOwner,
    marker: &recovery::RecoveryMarker,
    updates: &watch::Sender<Snapshot>,
    snapshot: &Snapshot,
) {
    if !matches!(
        snapshot.status,
        RunPhase::Completed | RunPhase::Failed | RunPhase::Stopped
    ) || updates.borrow().run_id != snapshot.run_id
    {
        return;
    }
    let interrupted = snapshot.status != RunPhase::Completed;
    let stored = match conversation.id.lock() {
        Ok(id)
            if updates.borrow().run_id == snapshot.run_id
                && updates.borrow().conversation_id == *id
                && snapshot.conversation_id == *id =>
        {
            let record = history::record_from_snapshot(&id, snapshot, interrupted);
            match record {
                Some(record) => conversation.history.upsert(record),
                None => Ok(()),
            }
        }
        Ok(_) => return,
        Err(_) => Err(AgentError::internal("Conversation history is unavailable.")),
    };
    let mut notices: Vec<String> = Vec::new();
    if stored.is_err() {
        notices.push(
            "Conversation history could not be saved; a restart may not restore this conversation."
                .into(),
        );
    }
    if stored.is_ok() && marker.clear_if(snapshot.run_id).is_err() {
        notices.push(MARKER_CLEAR_NOTICE.into());
    }
    if !notices.is_empty() {
        let notice = notices.join(" ");
        mutate(updates, |state| {
            if state.run_id == snapshot.run_id {
                state.error = Some(match state.error.take() {
                    Some(existing) => format!("{existing} {notice}"),
                    None => notice,
                });
            }
        });
    }
}

pub(crate) fn validate_prompt(text: &str) -> Result<String, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_PROMPT_BYTES {
        return Err("Enter a question (up to 12,000 bytes).".into());
    }
    Ok(trimmed.to_owned())
}

pub(crate) fn contextual_prompt(messages: &[ChatMessage], text: &str) -> String {
    if messages.is_empty() {
        return text.to_owned();
    }
    let header = "Previous Otto conversation:\n";
    let question_header = "\nNew user question:\n";
    let mut remaining = 48_000usize.saturating_sub(
        header
            .len()
            .saturating_add(question_header.len())
            .saturating_add(text.len()),
    );
    let mut selected = Vec::new();
    for message in messages.iter().rev().take(12) {
        let role = if message.role == "user" {
            "User"
        } else {
            "Otto"
        };
        let entry = format!("{role}: {}\n", message.text);
        if entry.len() > remaining {
            break;
        }
        remaining -= entry.len();
        selected.push(entry);
    }
    let mut context = String::from(header);
    for entry in selected.into_iter().rev() {
        context.push_str(&entry);
    }
    context.push_str(question_header);
    context.push_str(text);
    context
}
