use super::error::AgentError;
use super::{ChatMessage, ProviderId, Snapshot};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

const CURRENT_VERSION: u32 = 1;
const MAX_CONVERSATIONS: usize = 200;
const MAX_MESSAGES: usize = 24;
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

    pub fn list(&self) -> Result<Vec<ConversationSummary>, AgentError> {
        let _guard = self
            .writer
            .lock()
            .map_err(|_| AgentError::internal("History store is unavailable."))?;
        let data = self.read_locked()?;
        Ok(data
            .conversations
            .iter()
            .map(|record| ConversationSummary {
                id: record.id.clone(),
                title: record.title.clone(),
                provider: record.provider,
                preview: record
                    .messages
                    .first()
                    .map(|message| message.text.chars().take(MAX_TITLE_CHARS).collect())
                    .unwrap_or_default(),
                updated_at: record.updated_at,
                message_count: record.messages.len(),
                interrupted: record.interrupted,
            })
            .collect())
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

    fn read_locked(&self) -> Result<HistoryFile, AgentError> {
        let Some(path) = self.path.as_ref() else {
            return Ok(HistoryFile {
                version: CURRENT_VERSION,
                conversations: Vec::new(),
            });
        };
        let bytes = match fs::read(path) {
            Ok(bytes) => bytes,
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
        let mut data: HistoryFile = match serde_json::from_slice(&bytes) {
            Ok(data) => data,
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
        let bytes = serde_json::to_vec_pretty(data)
            .map_err(|_| AgentError::persistence_failed("History could not be encoded."))?;
        let result = (|| {
            let mut file = fs::File::create(&temporary).map_err(|_| {
                AgentError::persistence_failed("History temporary file could not be created.")
            })?;
            file.write_all(&bytes).map_err(|_| {
                AgentError::persistence_failed("History temporary file could not be written.")
            })?;
            file.sync_all().map_err(|_| {
                AgentError::persistence_failed("History temporary file could not be flushed.")
            })?;
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
    if interrupted
        && messages
            .last()
            .is_some_and(|message| message.role == "assistant")
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
}
