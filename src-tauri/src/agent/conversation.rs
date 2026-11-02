use super::error::AgentError;
use super::{Snapshot, history};
use std::sync::{Arc, Mutex};

pub(super) struct ConversationOwner {
    pub(super) history: Arc<history::HistoryStore>,
    pub(super) id: Mutex<String>,
}

impl ConversationOwner {
    pub(super) fn new(history: Arc<history::HistoryStore>, id: String) -> Self {
        Self {
            history,
            id: Mutex::new(id),
        }
    }

    pub(super) fn persist_snapshot(
        &self,
        snapshot: &Snapshot,
        interrupted: bool,
    ) -> Result<(), AgentError> {
        let id = self
            .id
            .lock()
            .map_err(|_| AgentError::internal("Conversation history is unavailable."))?;
        if snapshot.conversation_id != *id {
            return Err(AgentError::internal("Conversation identity is no longer current."));
        }
        if let Some(record) = history::record_from_snapshot(&id, snapshot, interrupted) {
            self.history.upsert(record)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_conversation_cannot_write_under_new_identity() {
        let owner = ConversationOwner::new(
            Arc::new(history::HistoryStore::memory()),
            "current".into(),
        );
        let mut snapshot = crate::agent::AgentRuntime::new().snapshot();
        snapshot.messages.push(crate::agent::ChatMessage {
            id: "1:user".into(),
            role: "user".into(),
            text: "Old question".into(),
        });
        assert!(owner.persist_snapshot(&snapshot, false).is_err());
        assert!(owner.history.list().unwrap().is_empty());
        snapshot.conversation_id = "current".into();
        owner.persist_snapshot(&snapshot, false).unwrap();
        assert_eq!(owner.history.open("current").unwrap().messages.len(), 1);
    }
}
