use super::error::AgentError;
use super::{ChatMessage, Snapshot, history};
use std::sync::{Arc, Mutex};

const MAX_TRANSCRIPT_MESSAGES: usize = 24;
const MAX_ASSISTANT_TEXT: usize = 128_000;

pub(super) fn start_turn(messages: &mut Vec<ChatMessage>, run_id: u64, text: String) {
    messages.push(ChatMessage {
        id: format!("{run_id}:user"),
        role: "user".into(),
        text,
    });
    messages.push(ChatMessage {
        id: format!("{run_id}:assistant"),
        role: "assistant".into(),
        text: String::new(),
    });
    let overflow = messages.len().saturating_sub(MAX_TRANSCRIPT_MESSAGES);
    if overflow > 0 {
        messages.drain(..overflow);
    }
}

fn belongs_to_run(message: &ChatMessage, run_id: u64) -> bool {
    message.role == "assistant"
        && message
            .id
            .split_once(':')
            .is_some_and(|(id, role)| role == "assistant" && id.parse::<u64>() == Ok(run_id))
}

fn current_answer(messages: &mut [ChatMessage], run_id: u64) -> Option<&mut ChatMessage> {
    messages.last_mut().filter(|message| belongs_to_run(message, run_id))
}

pub(super) fn append_delta(messages: &mut [ChatMessage], run_id: u64, delta: &str) -> bool {
    let Some(answer) = current_answer(messages, run_id) else {
        return false;
    };
    if delta.is_empty() || answer.text.len().saturating_add(delta.len()) > MAX_ASSISTANT_TEXT {
        return false;
    }
    answer.text.push_str(delta);
    true
}

pub(super) fn set_final(messages: &mut [ChatMessage], run_id: u64, text: &str) -> bool {
    let Some(answer) = current_answer(messages, run_id) else {
        return false;
    };
    let final_text: String = text.chars().take(MAX_ASSISTANT_TEXT).collect();
    if answer.text == final_text {
        return false;
    }
    answer.text = final_text;
    true
}

pub(super) fn has_answer(messages: &[ChatMessage], run_id: u64) -> bool {
    messages
        .last()
        .is_some_and(|answer| belongs_to_run(answer, run_id) && !answer.text.trim().is_empty())
}

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
    fn transcript_updates_only_the_matching_run_and_bounds_history() {
        let mut messages = (0..24)
            .map(|id| ChatMessage {
                id: format!("{id}:user"),
                role: "user".into(),
                text: format!("older {id}"),
            })
            .collect::<Vec<_>>();
        start_turn(&mut messages, 25, "new question".into());
        assert_eq!(messages.len(), 24);
        assert_eq!(messages.first().unwrap().id, "2:user");
        assert!(!append_delta(&mut messages, 24, "wrong run"));
        assert!(append_delta(&mut messages, 25, "part"));
        assert!(set_final(&mut messages, 25, "complete"));
        assert!(!set_final(&mut messages, 25, "complete"));
        assert!(has_answer(&messages, 25));
        assert!(!has_answer(&messages, 24));
        assert_eq!(messages.last().unwrap().text, "complete");
    }

    #[test]
    fn stale_conversation_cannot_write_under_new_identity() {
        let root = std::env::temp_dir().join(format!(
            "otto-conversation-owner-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let owner = ConversationOwner::new(
            Arc::new(history::HistoryStore::file(root.join("conversations.json"))),
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
        let _ = std::fs::remove_dir_all(root);
    }
}
