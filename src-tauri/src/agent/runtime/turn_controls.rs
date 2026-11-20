use super::{
    prompt::{AssistantGuidance, AssistantProfile, validate_prompt},
    run::TurnRequest,
    session::wait_for_terminal_run,
};
use crate::agent::{
    AcceptedRun, AgentRuntime, Control, ModelSelection, PermissionDecision, ProviderId, RunPhase,
    model::default_workspace_path, mutate,
};
use serde::Deserialize;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnOptions {
    pub provider: String,
    pub model: Option<String>,
    pub thinking_effort: Option<String>,
    pub mode: Option<String>,
    pub profile: Option<AssistantProfile>,
}

#[derive(Clone)]
pub(crate) struct QueuedFollowup {
    pub(crate) target_run_id: u64,
    pub(crate) text: String,
    pub(crate) provider: String,
    pub(crate) selection: ModelSelection,
    pub(crate) guidance: AssistantGuidance,
}

#[derive(Default)]
pub(crate) struct FollowupQueueState {
    pub(crate) item: Option<QueuedFollowup>,
    pub(crate) watching_run_id: Option<u64>,
}

impl AgentRuntime {
    pub async fn retry_last_turn(
        &self,
        provider: String,
        model: Option<String>,
        thinking_effort: Option<String>,
        mode: Option<String>,
        profile: Option<AssistantProfile>,
    ) -> Result<AcceptedRun, String> {
        let guidance = self.resolve_guidance(mode, profile)?;
        let current = self.snapshot();
        ensure_turn_editable(&current)?;
        let last_user_idx = current
            .messages
            .iter()
            .rposition(|message| message.role == "user")
            .ok_or("There is no previous question to retry.")?;
        let text = current.messages[last_user_idx].text.clone();
        self.ask_with_context(TurnRequest {
            text,
            cwd: default_workspace_path().to_string_lossy().into_owned(),
            provider,
            selection: ModelSelection {
                model,
                thinking_effort,
            },
            capture: None,
            selected_text: None,
            guidance,
            truncate_messages_to: Some(last_user_idx),
            consume_staged: false,
        })
        .await
    }

    pub async fn edit_and_rerun(
        &self,
        message_id: String,
        text: String,
        options: TurnOptions,
    ) -> Result<AcceptedRun, String> {
        let TurnOptions {
            provider,
            model,
            thinking_effort,
            mode,
            profile,
        } = options;
        let text = validate_prompt(&text)?;
        let guidance = self.resolve_guidance(mode, profile)?;
        let current = self.snapshot();
        ensure_turn_editable(&current)?;
        let target_idx = current
            .messages
            .iter()
            .position(|message| message.id == message_id && message.role == "user")
            .ok_or("Selected prompt is no longer in this conversation.")?;
        self.ask_with_context(TurnRequest {
            text,
            cwd: default_workspace_path().to_string_lossy().into_owned(),
            provider,
            selection: ModelSelection {
                model,
                thinking_effort,
            },
            capture: None,
            selected_text: None,
            guidance,
            truncate_messages_to: Some(target_idx),
            consume_staged: false,
        })
        .await
    }

    pub fn queue_followup(
        &self,
        text: String,
        provider: String,
        model: Option<String>,
        thinking_effort: Option<String>,
        mode: Option<String>,
        profile: Option<AssistantProfile>,
    ) -> Result<String, String> {
        let text = validate_prompt(&text)?;
        let guidance = self.resolve_guidance(mode, profile)?;
        let selected = ProviderId::parse(&provider).ok_or("Selected provider is unavailable.")?;
        let current = self.snapshot();
        if current.status == RunPhase::Stopping {
            return Err("Cannot queue a follow-up while stopping.".into());
        }
        if !matches!(current.status, RunPhase::Starting | RunPhase::Streaming) {
            return Err("No active answer to queue behind.".into());
        }
        if current.provider != selected {
            return Err("Queued follow-up must use the active AI engine.".into());
        }
        let target_run_id = current.run_id;
        let should_spawn = {
            let mut slot = self
                .followup_queue
                .lock()
                .map_err(|_| "Follow-up queue is unavailable.".to_string())?;
            slot.item = Some(QueuedFollowup {
                target_run_id,
                text: text.clone(),
                provider,
                selection: ModelSelection {
                    model,
                    thinking_effort,
                },
                guidance,
            });
            let spawn = slot.watching_run_id != Some(target_run_id);
            if spawn {
                slot.watching_run_id = Some(target_run_id);
            }
            spawn
        };
        mutate(&self.updates, |state| {
            if state.run_id == target_run_id
                && matches!(state.status, RunPhase::Starting | RunPhase::Streaming)
            {
                state.queued_followup = Some(text.clone());
            }
        });
        if should_spawn {
            let runtime = self.clone();
            let watcher = self.subscribe_updates();
            tokio::spawn(async move {
                wait_for_terminal_run(watcher, target_run_id).await;
                runtime.process_queued_followup(target_run_id).await;
            });
        }
        Ok(text)
    }

    pub fn clear_queued_followup(&self) -> Option<String> {
        let removed = self
            .followup_queue
            .lock()
            .ok()
            .and_then(|mut slot| slot.item.take())
            .map(|item| item.text);
        if removed.is_some() || self.updates.borrow().queued_followup.is_some() {
            mutate(&self.updates, |state| {
                state.queued_followup = None;
            });
        }
        removed
    }

    pub async fn respond_permission(&self, request_id: String, allow: bool) -> Result<(), String> {
        let request_id = request_id.trim().to_owned();
        if request_id.is_empty() {
            return Err("Permission request ID is required.".into());
        }
        let guard = self.control.lock().await;
        let current = self.snapshot();
        if !matches!(current.status, RunPhase::Starting | RunPhase::Streaming) {
            return Err("Permission request is no longer active.".into());
        }
        let Some(pending) = current.pending_permission.as_ref() else {
            return Err("No permission request is waiting for a decision.".into());
        };
        if pending.request_id != request_id || pending.run_id != current.run_id {
            return Err("Permission request is no longer current.".into());
        }
        let sender = guard.as_ref().ok_or("No active agent process.")?;
        let permit = sender
            .try_reserve()
            .map_err(|_| "Agent is busy; retry your permission decision.".to_string())?;
        let decision = if allow {
            PermissionDecision::AllowOnce
        } else {
            PermissionDecision::Decline
        };
        mutate(&self.updates, |state| {
            if state.run_id == current.run_id
                && state
                    .pending_permission
                    .as_ref()
                    .is_some_and(|item| item.request_id == request_id)
            {
                state.pending_permission = None;
            }
        });
        permit.send(Control::PermissionDecision {
            request_id,
            decision,
        });
        Ok(())
    }

    pub(crate) fn drop_queued_followup(&self) {
        if let Ok(mut slot) = self.followup_queue.lock() {
            slot.item = None;
            slot.watching_run_id = None;
        }
        if self.updates.borrow().queued_followup.is_some() {
            mutate(&self.updates, |state| {
                state.queued_followup = None;
            });
        }
    }

    async fn process_queued_followup(&self, target_run_id: u64) {
        let queued = {
            let Ok(mut slot) = self.followup_queue.lock() else {
                return;
            };
            if slot.watching_run_id == Some(target_run_id) {
                slot.watching_run_id = None;
            }
            if slot
                .item
                .as_ref()
                .is_some_and(|item| item.target_run_id == target_run_id)
            {
                slot.item.take()
            } else {
                None
            }
        };
        let Some(queued) = queued else {
            return;
        };
        if self.updates.borrow().queued_followup.is_some() {
            mutate(&self.updates, |state| {
                state.queued_followup = None;
            });
        }
        let latest = self.snapshot();
        if latest.run_id != target_run_id || latest.status != RunPhase::Completed {
            return;
        }
        if let Err(error) = self
            .ask_with_context(TurnRequest {
                text: queued.text,
                cwd: default_workspace_path().to_string_lossy().into_owned(),
                provider: queued.provider,
                selection: queued.selection,
                capture: None,
                selected_text: None,
                guidance: queued.guidance,
                truncate_messages_to: None,
                consume_staged: false,
            })
            .await
        {
            mutate(&self.updates, |state| {
                if state.run_id == target_run_id && state.status == RunPhase::Completed {
                    state.status = RunPhase::Failed;
                    state.error = Some(error);
                }
            });
        }
    }
}

fn ensure_turn_editable(current: &crate::agent::Snapshot) -> Result<(), String> {
    if matches!(
        current.status,
        RunPhase::Starting | RunPhase::Streaming | RunPhase::Stopping
    ) {
        return Err("An answer is already running.".into());
    }
    if !matches!(current.capture.phase.as_str(), "idle" | "failed") {
        return Err("Finish or cancel the current screen capture before retrying.".into());
    }
    Ok(())
}
