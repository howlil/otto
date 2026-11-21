use super::session::close_owned_transport;
use super::session::ensure_session_can_reset;
use crate::agent::conversation as history;
use crate::agent::error::AgentError;
use crate::agent::*;
use std::{sync::Arc, time::Duration};

impl AgentRuntime {
    #[cfg(test)]
    pub(crate) fn persist_prompt(&self, run_id: u64, text: &str) -> Result<(), AgentError> {
        self.persist_prompt_at(run_id, text, None)
    }

    #[cfg(test)]
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

    pub(crate) fn stage_prompt_and_persist_async(
        &self,
        run_id: u64,
        text: &str,
        truncate_to: Option<usize>,
    ) {
        let pending = ChatMessage {
            id: format!("{run_id}:user"),
            role: "user".into(),
            text: text.to_owned(),
        };
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
        let conversation = Arc::clone(&self.conversation);
        let updates = self.updates.clone();
        tokio::task::spawn_blocking(move || {
            let current = updates.borrow().clone();
            if current.run_id == run_id
                && matches!(current.status, RunPhase::Starting | RunPhase::Streaming)
            {
                let _ = conversation.persist_snapshot(&current, true);
            }
        });
    }

    pub(crate) fn persist_current_snapshot(&self, interrupted: bool) -> Result<(), AgentError> {
        self.conversation
            .persist_snapshot(&self.snapshot(), interrupted)
    }

    pub fn history_list(
        &self,
        query: Option<&str>,
    ) -> Result<Vec<history::ConversationSummary>, String> {
        self.conversation
            .history
            .list_filtered(query)
            .map_err(String::from)
    }

    pub fn history_export_markdown(&self, id: &str) -> Result<String, String> {
        self.conversation
            .history
            .export_markdown(id)
            .map_err(String::from)
    }

    pub async fn history_open(&self, id: &str) -> Result<Snapshot, String> {
        let mut guard = self.control.lock().await;
        let current = self.snapshot();
        let mut record = self.conversation.history.open(id)?;
        if current.conversation_id == record.id {
            if matches!(
                current.status,
                RunPhase::Starting | RunPhase::Streaming | RunPhase::Stopping
            ) || !matches!(current.capture.phase.as_str(), "idle" | "failed")
            {
                return Err(
                    "Finish or Stop the current request or capture before opening history.".into(),
                );
            }
            self.persist_current_snapshot(current.status != RunPhase::Completed)?;
            record = self.conversation.history.open(id)?;
        }
        self.new_session_locked(&mut guard, Duration::from_secs(5))
            .await?;
        let mut active_id = self
            .conversation
            .id
            .lock()
            .map_err(|_| AgentError::internal("Conversation history is unavailable."))?;
        let pending = if record.provider.capabilities().pending_model_selection {
            ModelSelection {
                model: record.model.clone(),
                thinking_effort: record.thinking_effort.clone(),
            }
        } else {
            ModelSelection::default()
        };
        *self.selected_runtime.lock().unwrap() = pending;
        *active_id = record.id.clone();
        mutate(&self.updates, |state| {
            let switched_provider = state.provider != record.provider;
            state.conversation_id = record.id.clone();
            state.provider = record.provider;
            state.model = record.model.clone();
            state.thinking_effort = record.thinking_effort.clone();
            state.thread_id = None;
            state.usage = None;
            if switched_provider {
                state.rate_limits.clear();
            }
            state.messages = record.messages.clone();
            state.status = if record.interrupted {
                RunPhase::Failed
            } else {
                RunPhase::Completed
            };
            state.error = record.interrupted.then(|| {
                "This saved conversation was interrupted. Send a new message to continue.".into()
            });
            state.capture = CaptureSnapshot::default();
            state.queued_followup = None;
            state.pending_permission = None;
        });
        drop(active_id);
        let opened = self.snapshot();
        drop(guard);
        Ok(opened)
    }

    pub fn history_rename(&self, id: &str, title: &str) -> Result<(), String> {
        self.conversation
            .history
            .rename(id, title)
            .map_err(String::from)
    }

    pub async fn history_delete(&self, id: &str) -> Result<(), String> {
        let mut guard = self.control.lock().await;
        self.conversation.history.open(id)?;
        let current = self.snapshot();
        if current.conversation_id != id.trim() {
            return self.conversation.history.delete(id).map_err(String::from);
        }

        ensure_session_can_reset(&current)?;
        if let Some(sender) = guard.as_ref().filter(|sender| !sender.is_closed()) {
            close_owned_transport(sender, Duration::from_secs(5)).await?;
        }
        let mut active_id = self
            .conversation
            .id
            .lock()
            .map_err(|_| "Conversation history is unavailable.")?;
        if let Err(error) = self.conversation.history.delete(id) {
            *guard = None;
            drop(active_id);
            mutate(&self.updates, |state| state.thread_id = None);
            return Err(String::from(error));
        }
        self.rotate_session_locked(&mut guard, &current, &mut active_id);
        Ok(())
    }

    pub async fn history_delete_all(&self) -> Result<(), String> {
        let mut guard = self.control.lock().await;
        let current = self.snapshot();
        ensure_session_can_reset(&current)?;
        if let Some(sender) = guard.as_ref().filter(|sender| !sender.is_closed()) {
            close_owned_transport(sender, Duration::from_secs(5)).await?;
        }
        let mut active_id = self
            .conversation
            .id
            .lock()
            .map_err(|_| "Conversation history is unavailable.")?;
        if let Err(error) = self.conversation.history.delete_all() {
            *guard = None;
            drop(active_id);
            mutate(&self.updates, |state| state.thread_id = None);
            return Err(String::from(error));
        }
        self.rotate_session_locked(&mut guard, &current, &mut active_id);
        Ok(())
    }
}
