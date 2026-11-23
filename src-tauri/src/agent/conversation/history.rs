use super::export::{format_conversation_markdown, matches_query, matching_preview};
use crate::agent::{ChatMessage, ProviderId, RunPhase, Snapshot, error::AgentError};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{BufReader, BufWriter, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

const CURRENT_VERSION: u32 = 1;
const MAX_CONVERSATIONS: usize = 200;
const MAX_MESSAGES: usize = 100;
const MAX_TITLE_CHARS: usize = 120;
const MAX_MESSAGE_CHARS: usize = 128_000;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationRecord {
    pub id: String,
    pub title: String,
    pub provider: ProviderId,
    pub model: Option<String>,
    pub thinking_effort: Option<String>,
    pub messages: Vec<ChatMessage>,
    pub created_at: u64,
    pub updated_at: u64,
    pub interrupted: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub id: String,
    pub title: String,
    pub provider: ProviderId,
    pub preview: String,
    pub updated_at: u64,
    pub message_count: usize,
    pub interrupted: bool,
}

#[derive(Default, Serialize, Deserialize)]
struct HistoryFile {
    version: u32,
    conversations: Vec<ConversationRecord>,
}

pub struct HistoryStore {
    path: Option<PathBuf>,
    writer: Mutex<()>,
}

impl HistoryStore {
    pub fn memory() -> Self {
        Self {
            path: None,
            writer: Mutex::new(()),
        }
    }

    pub fn file(path: PathBuf) -> Self {
        Self {
            path: Some(path),
            writer: Mutex::new(()),
        }
    }

    #[cfg(test)]
    pub fn list(&self) -> Result<Vec<ConversationSummary>, AgentError> {
        self.list_filtered(None)
    }

    pub fn list_filtered(
        &self,
        query: Option<&str>,
    ) -> Result<Vec<ConversationSummary>, AgentError> {
        let _guard = self
            .writer
            .lock()
            .map_err(|_| AgentError::internal("History store is unavailable."))?;
        let data = self.read_locked()?;
        let filter = query.map(str::trim).filter(|value| !value.is_empty());
        Ok(data
            .conversations
            .iter()
            .filter(|record| filter.is_none_or(|value| matches_query(record, value)))
            .map(|record| ConversationSummary {
                id: record.id.clone(),
                title: record.title.clone(),
                provider: record.provider,
                preview: matching_preview(record, filter, MAX_TITLE_CHARS),
                updated_at: record.updated_at,
                message_count: record.messages.len(),
                interrupted: record.interrupted,
            })
            .collect())
    }

    pub fn export_markdown(&self, id: &str) -> Result<String, AgentError> {
        let record = self.open(id)?;
        Ok(format_conversation_markdown(&record))
    }

    pub fn open(&self, id: &str) -> Result<ConversationRecord, AgentError> {
        let id = validate_id(id)?;
        let _guard = self
            .writer
            .lock()
            .map_err(|_| AgentError::internal("History store is unavailable."))?;
        self.read_locked()?
            .conversations
            .into_iter()
            .find(|record| record.id == id)
            .ok_or_else(|| AgentError::invalid_request("Conversation was not found."))
    }

    pub fn upsert(&self, record: ConversationRecord) -> Result<(), AgentError> {
        validate_record(&record)?;
        let _guard = self
            .writer
            .lock()
            .map_err(|_| AgentError::internal("History store is unavailable."))?;
        let mut data = self.read_locked()?;
        if let Some(existing) = data
            .conversations
            .iter_mut()
            .find(|existing| existing.id == record.id)
        {
            let mut record = record;
            record.created_at = existing.created_at;
            record.title = existing.title.clone();
            *existing = record;
        } else {
            data.conversations.push(record);
        }
        data.conversations
            .sort_by_key(|record| std::cmp::Reverse(record.updated_at));
        data.conversations.truncate(MAX_CONVERSATIONS);
        self.write_locked(&data)
    }

    pub fn rename(&self, id: &str, title: &str) -> Result<(), AgentError> {
        let id = validate_id(id)?;
        let title = normalize_title(title)?;
        let _guard = self
            .writer
            .lock()
            .map_err(|_| AgentError::internal("History store is unavailable."))?;
        let mut data = self.read_locked()?;
        let record = data
            .conversations
            .iter_mut()
            .find(|record| record.id == id)
            .ok_or_else(|| AgentError::invalid_request("Conversation was not found."))?;
        record.title = title;
        record.updated_at = now();
        self.write_locked(&data)
    }

    pub fn delete(&self, id: &str) -> Result<(), AgentError> {
        let id = validate_id(id)?;
        let _guard = self
            .writer
            .lock()
            .map_err(|_| AgentError::internal("History store is unavailable."))?;
        let mut data = self.read_locked()?;
        let count = data.conversations.len();
        data.conversations.retain(|record| record.id != id);
        if data.conversations.len() == count {
            return Err(AgentError::invalid_request("Conversation was not found."));
        }
        self.write_locked(&data)
    }

    pub fn delete_all(&self) -> Result<(), AgentError> {
        let _guard = self
            .writer
            .lock()
            .map_err(|_| AgentError::internal("History store is unavailable."))?;
        let mut data = self.read_locked()?;
        data.conversations.clear();
        self.write_locked(&data)
    }

    fn read_locked(&self) -> Result<HistoryFile, AgentError> {
        let Some(path) = self.path.as_ref() else {
            return Ok(HistoryFile {
                version: CURRENT_VERSION,
                conversations: Vec::new(),
            });
        };
        let parsed = {
            let file = match fs::File::open(path) {
                Ok(file) => file,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    return Ok(HistoryFile {
                        version: CURRENT_VERSION,
                        conversations: Vec::new(),
                    });
                }
                Err(_) => {
                    return Err(AgentError::persistence_failed(
                        "Conversation history could not be read.",
                    ));
                }
            };
            serde_json::from_reader::<_, HistoryFile>(BufReader::new(file))
        };
        let mut data: HistoryFile = match parsed {
            Ok(data) => data,
            Err(error) if error.is_io() => {
                return Err(AgentError::persistence_failed(
                    "Conversation history could not be read.",
                ));
            }
            Err(_) => {
                recover_corrupt(path);
                HistoryFile {
                    version: CURRENT_VERSION,
                    conversations: Vec::new(),
                }
            }
        };
        if data.version != CURRENT_VERSION {
            data = migrate(data)?;
        }
        data.conversations
            .retain(|record| validate_record(record).is_ok());
        data.conversations
            .sort_by_key(|record| std::cmp::Reverse(record.updated_at));
        data.conversations.truncate(MAX_CONVERSATIONS);
        Ok(data)
    }

    fn write_locked(&self, data: &HistoryFile) -> Result<(), AgentError> {
        let Some(path) = self.path.as_ref() else {
            return Ok(());
        };
        let parent = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .ok_or_else(|| AgentError::persistence_failed("History directory is unavailable."))?;
        fs::create_dir_all(parent).map_err(|_| {
            AgentError::persistence_failed("History directory could not be created.")
        })?;
        let temporary = path.with_extension(format!("json.tmp-{}", std::process::id()));
        let result = (|| {
            let file = fs::File::create(&temporary).map_err(|_| {
                AgentError::persistence_failed("History temporary file could not be created.")
            })?;
            let mut writer = BufWriter::new(file);
            serde_json::to_writer(&mut writer, data).map_err(|error| {
                if error.is_io() {
                    AgentError::persistence_failed("History temporary file could not be written.")
                } else {
                    AgentError::persistence_failed("History could not be encoded.")
                }
            })?;
            writer.flush().map_err(|_| {
                AgentError::persistence_failed("History temporary file could not be written.")
            })?;
            let file = writer.into_inner().map_err(|_| {
                AgentError::persistence_failed("History temporary file could not be flushed.")
            })?;
            file.sync_all().map_err(|_| {
                AgentError::persistence_failed("History temporary file could not be flushed.")
            })?;
            drop(file);
            commit_file(&temporary, path)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }
}

#[cfg(windows)]
fn commit_file(temporary: &Path, path: &Path) -> Result<(), AgentError> {
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };
    let temporary: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
    let path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let moved = unsafe {
        MoveFileExW(
            temporary.as_ptr(),
            path.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        Err(AgentError::persistence_failed(
            "History file could not be committed.",
        ))
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn commit_file(temporary: &Path, path: &Path) -> Result<(), AgentError> {
    fs::rename(temporary, path)
        .map_err(|_| AgentError::persistence_failed("History file could not be committed."))
}

pub fn new_id() -> String {
    format!("conversation-{}-{}", unique_stamp(), std::process::id())
}

pub fn record_from_snapshot(
    id: &str,
    snapshot: &Snapshot,
    interrupted: bool,
) -> Option<ConversationRecord> {
    let mut messages = snapshot.messages.clone();
    let keep_stopped_partial = snapshot.status == RunPhase::Stopped
        && messages.last().is_some_and(|message| {
            message.role == "assistant"
                && message.id == format!("{}:assistant", snapshot.run_id)
                && !message.text.trim().is_empty()
        });
    if interrupted
        && !keep_stopped_partial
        && messages.last().is_some_and(|message| {
            message.role == "assistant" && message.id == format!("{}:assistant", snapshot.run_id)
        })
    {
        messages.pop();
    }
    if messages.is_empty() {
        return None;
    }
    if messages.len() > MAX_MESSAGES {
        messages.drain(..messages.len() - MAX_MESSAGES);
    }
    let title = messages
        .iter()
        .find(|message| message.role == "user")
        .map(|message| normalize_title(&message.text).unwrap_or_else(|_| "Conversation".into()))
        .unwrap_or_else(|| "Conversation".into());
    Some(ConversationRecord {
        id: id.to_owned(),
        title,
        provider: snapshot.provider,
        model: snapshot.model.clone(),
        thinking_effort: snapshot.thinking_effort.clone(),
        messages,
        created_at: now(),
        updated_at: now(),
        interrupted,
    })
}

fn migrate(data: HistoryFile) -> Result<HistoryFile, AgentError> {
    if data.version == 0 {
        return Ok(HistoryFile {
            version: CURRENT_VERSION,
            conversations: data.conversations,
        });
    }
    Err(AgentError::internal(
        "Conversation history uses an unsupported version.",
    ))
}

fn validate_record(record: &ConversationRecord) -> Result<(), AgentError> {
    validate_id(&record.id)?;
    if record.title.trim().is_empty() || record.title.chars().count() > MAX_TITLE_CHARS {
        return Err(AgentError::invalid_request(
            "Conversation title is invalid.",
        ));
    }
    if record.messages.len() > MAX_MESSAGES {
        return Err(AgentError::invalid_request(
            "Conversation has too many messages.",
        ));
    }
    if record.messages.iter().any(|message| {
        !matches!(message.role.as_str(), "user" | "assistant")
            || message.text.chars().count() > MAX_MESSAGE_CHARS
    }) {
        return Err(AgentError::invalid_request(
            "Conversation contains an invalid message.",
        ));
    }
    Ok(())
}

fn validate_id(id: &str) -> Result<String, AgentError> {
    let id = id.trim();
    if id.is_empty()
        || id.chars().count() > 100
        || id
            .chars()
            .any(|character| matches!(character, '/' | '\\' | ':'))
    {
        return Err(AgentError::invalid_request("Conversation ID is invalid."));
    }
    Ok(id.to_owned())
}

fn normalize_title(title: &str) -> Result<String, AgentError> {
    let title = title.trim();
    if title.is_empty() {
        return Err(AgentError::invalid_request(
            "Conversation title is required.",
        ));
    }
    Ok(title.chars().take(MAX_TITLE_CHARS).collect())
}

fn recover_corrupt(path: &Path) {
    let backup = path.with_extension(format!("json.corrupt-{}", unique_stamp()));
    let _ = fs::rename(path, backup);
}

fn unique_stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default()
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "otto-history-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn record(id: &str) -> ConversationRecord {
        ConversationRecord {
            id: id.into(),
            title: "Explain Rust".into(),
            provider: ProviderId::Codex,
            model: Some("model".into()),
            thinking_effort: Some("high".into()),
            messages: vec![ChatMessage {
                id: "1:user".into(),
                role: "user".into(),
                text: "Explain Rust".into(),
            }],
            created_at: 1,
            updated_at: 1,
            interrupted: false,
        }
    }

    #[test]
    fn history_round_trip_supports_list_open_rename_and_delete() {
        let path = temp_path("round-trip").join("history.json");
        let store = HistoryStore::file(path.clone());
        store.upsert(record("one")).unwrap();
        assert_eq!(store.list().unwrap()[0].title, "Explain Rust");
        assert_eq!(store.open("one").unwrap().messages.len(), 1);
        store.rename("one", "Renamed").unwrap();
        assert_eq!(store.open("one").unwrap().title, "Renamed");
        store.delete("one").unwrap();
        assert!(store.list().unwrap().is_empty());
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn delete_all_clears_every_saved_conversation() {
        let path = temp_path("delete-all").join("history.json");
        let store = HistoryStore::file(path.clone());
        store.upsert(record("one")).unwrap();
        store.upsert(record("two")).unwrap();
        store.delete_all().unwrap();
        assert!(store.list().unwrap().is_empty());
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn upsert_keeps_user_renamed_title_when_provider_and_transcript_change() {
        let path = temp_path("rename-preserve").join("history.json");
        let store = HistoryStore::file(path.clone());
        store.upsert(record("portable")).unwrap();
        store.rename("portable", "My Rust notes").unwrap();

        let mut next = record("portable");
        next.title = "Explain Rust".into();
        next.provider = ProviderId::Pi;
        next.messages.push(ChatMessage {
            id: "2:user".into(),
            role: "user".into(),
            text: "What is borrowing?".into(),
        });
        store.upsert(next).unwrap();

        let reopened = HistoryStore::file(path.clone()).open("portable").unwrap();
        assert_eq!(reopened.title, "My Rust notes");
        assert_eq!(reopened.provider, ProviderId::Pi);
        assert_eq!(reopened.messages.len(), 2);
        assert_eq!(reopened.created_at, 1);
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn interrupted_new_run_keeps_last_completed_answer() {
        let mut snapshot = crate::agent::AgentRuntime::new().snapshot();
        snapshot.run_id = 8;
        snapshot.messages = vec![
            ChatMessage {
                id: "7:user".into(),
                role: "user".into(),
                text: "Explain ownership.".into(),
            },
            ChatMessage {
                id: "7:assistant".into(),
                role: "assistant".into(),
                text: "Ownership controls cleanup.".into(),
            },
        ];

        let record = record_from_snapshot("existing-chat", &snapshot, true).unwrap();
        assert_eq!(record.messages.len(), 2);
        assert_eq!(record.messages[1].text, "Ownership controls cleanup.");
        assert!(record.interrupted);
    }

    #[test]
    fn interrupted_active_run_drops_only_its_incomplete_answer() {
        let mut snapshot = crate::agent::AgentRuntime::new().snapshot();
        snapshot.run_id = 8;
        snapshot.messages = vec![
            ChatMessage {
                id: "7:assistant".into(),
                role: "assistant".into(),
                text: "Previous complete answer.".into(),
            },
            ChatMessage {
                id: "8:user".into(),
                role: "user".into(),
                text: "Follow-up question.".into(),
            },
            ChatMessage {
                id: "8:assistant".into(),
                role: "assistant".into(),
                text: "Incomplete output.".into(),
            },
        ];

        let record = record_from_snapshot("existing-chat", &snapshot, true).unwrap();
        assert_eq!(record.messages.len(), 2);
        assert_eq!(record.messages[0].text, "Previous complete answer.");
        assert_eq!(record.messages[1].text, "Follow-up question.");
        assert!(
            !record
                .messages
                .iter()
                .any(|message| message.text == "Incomplete output.")
        );
    }

    #[test]
    fn list_summaries_carry_a_truncated_preview_of_the_first_message() {
        let path = temp_path("preview").join("history.json");
        let store = HistoryStore::file(path.clone());
        let mut record = record("one");
        record.messages.insert(
            0,
            ChatMessage {
                id: "0:user".into(),
                role: "user".into(),
                text: "x".repeat(200),
            },
        );
        record.messages[1].text = "Second question".into();
        store.upsert(record).unwrap();
        let summary = &store.list().unwrap()[0];
        assert_eq!(summary.preview.chars().count(), MAX_TITLE_CHARS);
        assert_eq!(summary.message_count, 2);
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn corrupted_history_is_quarantined_and_replaced_by_empty_state() {
        let path = temp_path("corrupt").join("history.json");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"not json").unwrap();
        let store = HistoryStore::file(path.clone());
        assert!(store.list().unwrap().is_empty());
        assert!(!path.exists());
        assert!(path.parent().unwrap().read_dir().unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains("corrupt-")
        }));
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn invalid_records_are_rejected_before_write() {
        let store = HistoryStore::memory();
        let mut invalid = record("../unsafe");
        assert!(store.upsert(invalid.clone()).is_err());
        invalid.id = "valid".into();
        invalid.messages[0].role = "system".into();
        assert!(store.upsert(invalid).is_err());
    }

    #[test]
    fn stopped_run_preserves_nonempty_partial_answer_with_interrupted_flag() {
        let mut snapshot = crate::agent::AgentRuntime::new().snapshot();
        snapshot.run_id = 8;
        snapshot.status = RunPhase::Stopped;
        snapshot.messages = vec![
            ChatMessage {
                id: "8:user".into(),
                role: "user".into(),
                text: "Derive Dijkstra complexity".into(),
            },
            ChatMessage {
                id: "8:assistant".into(),
                role: "assistant".into(),
                text: "With a binary heap, Dijkstra runs in O((V + E) log V)...".into(),
            },
        ];

        let record = record_from_snapshot("stopped-chat", &snapshot, true).unwrap();
        assert!(record.interrupted);
        assert_eq!(record.messages.len(), 2);
        assert_eq!(
            record.messages[1].text,
            "With a binary heap, Dijkstra runs in O((V + E) log V)..."
        );

        snapshot.messages[1].text = "   ".into();
        let empty_partial = record_from_snapshot("stopped-empty", &snapshot, true).unwrap();
        assert_eq!(empty_partial.messages.len(), 1);
        assert_eq!(empty_partial.messages[0].role, "user");
    }

    #[test]
    fn history_retains_up_to_100_messages_and_trims_overflow() {
        let mut snapshot = crate::agent::AgentRuntime::new().snapshot();
        snapshot.run_id = 120;
        snapshot.status = RunPhase::Completed;
        snapshot.messages = (0..108)
            .map(|idx| ChatMessage {
                id: format!("{idx}:user"),
                role: if idx % 2 == 0 { "user" } else { "assistant" }.into(),
                text: format!("Message {idx}"),
            })
            .collect();

        let record = record_from_snapshot("long-chat", &snapshot, false).unwrap();
        assert_eq!(record.messages.len(), 100);
        assert_eq!(record.messages.first().unwrap().text, "Message 8");
        assert_eq!(record.messages.last().unwrap().text, "Message 107");
    }

    #[test]
    fn list_filtered_searches_deep_message_bodies_and_exports_markdown() {
        let path = temp_path("search-export").join("history.json");
        let store = HistoryStore::file(path.clone());
        let mut first = record("algo-notes");
        first.title = "Study session".into();
        first.provider = ProviderId::Claude;
        first.model = Some("claude-sonnet".into());
        first.messages = vec![
            ChatMessage {
                id: "1:user".into(),
                role: "user".into(),
                text: "Help me revise graphs".into(),
            },
            ChatMessage {
                id: "1:assistant".into(),
                role: "assistant".into(),
                text: "Bellman-Ford handles negative edge weights cleanly.".into(),
            },
        ];
        let mut second = record("cooking");
        second.title = "Dinner ideas".into();
        second.messages = vec![ChatMessage {
            id: "2:user".into(),
            role: "user".into(),
            text: "Quick pasta sauce".into(),
        }];
        store.upsert(first).unwrap();
        store.upsert(second).unwrap();

        let deep_hits = store.list_filtered(Some("bellman-ford negative")).unwrap();
        assert_eq!(deep_hits.len(), 1);
        assert_eq!(deep_hits[0].id, "algo-notes");
        assert!(deep_hits[0].preview.contains("Bellman-Ford"));

        let provider_hits = store.list_filtered(Some("claude graphs")).unwrap();
        assert_eq!(provider_hits.len(), 1);
        assert_eq!(provider_hits[0].id, "algo-notes");

        let markdown = store.export_markdown("algo-notes").unwrap();
        assert!(markdown.contains("# Study session"));
        assert!(markdown.contains("- Engine: Claude Code"));
        assert!(markdown.contains("- Model: claude-sonnet"));
        assert!(markdown.contains("## You\n\nHelp me revise graphs"));
        assert!(
            markdown.contains("## Otto\n\nBellman-Ford handles negative edge weights cleanly.")
        );
        assert!(!markdown.contains("threadId"));
        assert!(!markdown.contains("cwd"));

        let _ = fs::remove_dir_all(path.parent().unwrap());
    }
}
