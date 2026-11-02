use super::ChatMessage;
use super::Snapshot;
use super::history::ConversationRecord;
use super::history::HistoryStore;
use std::time::Instant;

const MEASURED_CONVERSATIONS: usize = 200;
const MESSAGES_PER_CONVERSATION: usize = 24;
const MESSAGE_CHARS: usize = 1_000;

pub struct SnapshotMeasurements {
    pub serialized_bytes: usize,
    pub serialization_nanos: u128,
    pub clone_nanos: u128,
}

pub struct HistoryMeasurements {
    pub conversations: usize,
    pub messages_per_conversation: usize,
    pub file_bytes: usize,
    pub upsert_nanos: u128,
    pub list_nanos: u128,
}

pub fn measure_snapshot(serialized: &Snapshot) -> SnapshotMeasurements {
    let serialization = Instant::now();
    let encoded = serde_json::to_vec(serialized).unwrap_or_default();
    let serialization_nanos = serialization.elapsed().as_nanos();
    let clone_start = Instant::now();
    let cloned = serialized.clone();
    let clone_nanos = clone_start.elapsed().as_nanos();
    std::hint::black_box(&cloned);
    SnapshotMeasurements {
        serialized_bytes: encoded.len(),
        serialization_nanos,
        clone_nanos,
    }
}

pub fn measure_history() -> HistoryMeasurements {
    let root = std::env::temp_dir().join(format!(
        "otto-measure-history-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let store = HistoryStore::file(root.join("conversations.json"));
    let text = "A".repeat(MESSAGE_CHARS);
    let upsert = Instant::now();
    for conversation in 0..MEASURED_CONVERSATIONS {
        store
            .upsert(ConversationRecord {
                id: format!("conversation-{conversation}"),
                title: format!("Conversation {conversation}"),
                provider: super::providers::registry::ProviderId::Codex,
                model: Some("gpt-5.1-codex".into()),
                thinking_effort: Some("high".into()),
                messages: (0..MESSAGES_PER_CONVERSATION)
                    .map(|message| ChatMessage {
                        id: format!("{conversation}:{message}"),
                        role: if message % 2 == 0 {
                            "user"
                        } else {
                            "assistant"
                        }
                        .into(),
                        text: text.clone(),
                    })
                    .collect(),
                created_at: 1,
                updated_at: u64::try_from(conversation).unwrap_or(u64::MAX),
                interrupted: false,
            })
            .unwrap();
    }
    let upsert_nanos = upsert.elapsed().as_nanos();
    let list = Instant::now();
    let summaries = store.list().unwrap();
    let list_nanos = list.elapsed().as_nanos();
    let file_bytes = std::fs::metadata(root.join("conversations.json"))
        .map(|metadata| metadata.len() as usize)
        .unwrap_or(0);
    let _ = std::fs::remove_dir_all(root);
    HistoryMeasurements {
        conversations: summaries.len(),
        messages_per_conversation: MESSAGES_PER_CONVERSATION,
        file_bytes,
        upsert_nanos,
        list_nanos,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_snapshot() -> Snapshot {
        use crate::agent::AgentRuntime;
        AgentRuntime::new().snapshot()
    }

    #[test]
    fn snapshot_scope_is_measurable_and_warningly_small() {
        let measurements = measure_snapshot(&sample_snapshot());
        println!(
            "snapshot: serialized={}B serialization={:?} clone={:?}",
            measurements.serialized_bytes,
            measurements.serialization_nanos,
            measurements.clone_nanos
        );
        assert!(measurements.serialized_bytes > 0);
    }

    #[test]
    fn history_scale_200x24_is_measurable_and_read_latency_is_reported() {
        let measurements = measure_history();
        println!(
            "history: conversations={}x{} file={}KB upsert_all={:?} list={:?}",
            measurements.conversations,
            measurements.messages_per_conversation,
            measurements.file_bytes / 1_024,
            measurements.upsert_nanos,
            measurements.list_nanos
        );
        assert_eq!(measurements.conversations, MEASURED_CONVERSATIONS);
        assert!(measurements.file_bytes > 0);
    }
}
