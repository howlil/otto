use super::run::close_owned_transport;
use super::session::ensure_session_can_reset;
use crate::agent::error::AgentError;
use crate::agent::*;
use std::time::Duration;

impl AgentRuntime {
    pub fn history_list(&self) -> Result<Vec<history::ConversationSummary>, String> {
        self.conversation.history.list().map_err(String::from)
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
            state.conversation_id = record.id.clone();
            state.provider = record.provider;
            state.model = record.model.clone();
            state.thinking_effort = record.thinking_effort.clone();
            state.thread_id = None;
            state.usage = None;
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
