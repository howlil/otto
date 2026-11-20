use super::activity::ActivitySnapshot;
use super::capture_types::CapturedImage;
use super::permission::{PendingPermissionSnapshot, PermissionDecision};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
#[cfg(windows)]
use std::sync::Arc;
#[cfg(windows)]
use std::sync::atomic::AtomicBool;
use tokio::sync::{oneshot, watch};

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProviderId {
    #[default]
    Codex,
    Pi,
    Agy,
    Opencode,
    Claude,
    Gemini,
    Copilot,
    Qwen,
    Cursor,
    Goose,
    Vibe,
    Amp,
    Kilo,
    Junie,
    Cline,
    Augment,
    Droid,
    Grok,
    Devin,
}

impl ProviderId {
    pub const ALL: [Self; 19] = [
        Self::Codex,
        Self::Pi,
        Self::Agy,
        Self::Opencode,
        Self::Claude,
        Self::Gemini,
        Self::Copilot,
        Self::Qwen,
        Self::Cursor,
        Self::Goose,
        Self::Vibe,
        Self::Amp,
        Self::Kilo,
        Self::Junie,
        Self::Cline,
        Self::Augment,
        Self::Droid,
        Self::Grok,
        Self::Devin,
    ];

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "codex" => Some(Self::Codex),
            "pi" => Some(Self::Pi),
            "agy" => Some(Self::Agy),
            "opencode" => Some(Self::Opencode),
            "claude" => Some(Self::Claude),
            "gemini" => Some(Self::Gemini),
            "copilot" => Some(Self::Copilot),
            "qwen" => Some(Self::Qwen),
            "cursor" => Some(Self::Cursor),
            "goose" => Some(Self::Goose),
            "vibe" => Some(Self::Vibe),
            "amp" => Some(Self::Amp),
            "kilo" => Some(Self::Kilo),
            "junie" => Some(Self::Junie),
            "cline" => Some(Self::Cline),
            "augment" => Some(Self::Augment),
            "droid" => Some(Self::Droid),
            "grok" => Some(Self::Grok),
            "devin" => Some(Self::Devin),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Pi => "pi",
            Self::Agy => "agy",
            Self::Opencode => "opencode",
            Self::Claude => "claude",
            Self::Gemini => "gemini",
            Self::Copilot => "copilot",
            Self::Qwen => "qwen",
            Self::Cursor => "cursor",
            Self::Goose => "goose",
            Self::Vibe => "vibe",
            Self::Amp => "amp",
            Self::Kilo => "kilo",
            Self::Junie => "junie",
            Self::Cline => "cline",
            Self::Augment => "augment",
            Self::Droid => "droid",
            Self::Grok => "grok",
            Self::Devin => "devin",
        }
    }
}

#[cfg(test)]
impl From<&str> for ProviderId {
    fn from(value: &str) -> Self {
        Self::parse(value).unwrap()
    }
}

#[cfg(test)]
impl PartialEq<&str> for ProviderId {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub role: String,
    pub text: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOption {
    pub id: String,
    pub display_name: String,
    pub context_window: Option<i64>,
    pub image_input: bool,
    pub thinking_efforts: Vec<String>,
    pub default_thinking_effort: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    pub context_tokens: Option<i64>,
    pub session_tokens: i64,
    pub input_tokens: i64,
    pub cached_input_tokens: i64,
    pub output_tokens: i64,
    pub reasoning_output_tokens: Option<i64>,
    pub model_context_window: Option<i64>,
}

pub(crate) const MAX_ASSISTANT_TEXT: usize = 128_000;

pub(crate) fn default_workspace_path() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_default()
}

pub(crate) fn resolve_workspace_path(value: &str) -> PathBuf {
    let value = value.trim();
    if value.is_empty() || value == "~" {
        return default_workspace_path();
    }
    if let Some(relative) = value
        .strip_prefix("~/")
        .or_else(|| value.strip_prefix("~\\"))
    {
        return default_workspace_path().join(relative);
    }
    PathBuf::from(value)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRateLimit {
    pub id: String,
    pub label: String,
    pub window: String,
    pub used_percent: u8,
    pub remaining_percent: u8,
    pub resets_at: Option<String>,
    pub group: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderReadiness {
    pub status: String,
    pub message: String,
    pub recovery: String,

    pub image_input: bool,
    pub image_transport: bool,
    pub model: Option<String>,
    pub models: Vec<ModelOption>,
    pub thinking_effort: Option<String>,
    pub thinking_efforts: Vec<String>,
    pub rate_limits: Vec<ProviderRateLimit>,
}

#[derive(Clone, Default)]
pub(crate) struct ModelSelection {
    pub(crate) model: Option<String>,
    pub(crate) thinking_effort: Option<String>,
}

impl ProviderReadiness {
    pub fn new(status: &str, message: &str, recovery: &str) -> Self {
        Self {
            status: status.into(),
            message: message.into(),
            recovery: recovery.into(),
            image_input: false,
            image_transport: false,
            model: None,
            models: Vec::new(),
            thinking_effort: None,
            thinking_efforts: Vec::new(),
            rate_limits: Vec::new(),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub run_id: u64,
    pub seq: u64,
    pub status: RunPhase,
    pub provider: ProviderId,
    #[serde(skip)]
    pub cwd: String,
    pub conversation_id: String,
    pub thread_id: Option<String>,
    pub model: Option<String>,
    pub thinking_effort: Option<String>,
    pub usage: Option<UsageSnapshot>,
    pub rate_limits: Vec<ProviderRateLimit>,
    pub messages: Vec<ChatMessage>,
    pub activity: Vec<ActivitySnapshot>,
    pub capture: CaptureSnapshot,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queued_followup: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_permission: Option<PendingPermissionSnapshot>,
    pub error: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RunPhase {
    Idle,
    Starting,
    Streaming,
    Stopping,
    Completed,
    Failed,
    Stopped,
}

impl RunPhase {
    #[cfg(test)]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Starting => "starting",
            Self::Streaming => "streaming",
            Self::Stopping => "stopping",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Stopped => "stopped",
        }
    }
}

#[cfg(test)]
impl From<&str> for RunPhase {
    fn from(value: &str) -> Self {
        match value {
            "idle" => Self::Idle,
            "starting" => Self::Starting,
            "streaming" => Self::Streaming,
            "stopping" => Self::Stopping,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            "stopped" => Self::Stopped,
            _ => panic!("invalid run phase"),
        }
    }
}

#[cfg(test)]
impl PartialEq<&str> for RunPhase {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptedRun {
    pub run_id: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedCaptureSnapshot {
    pub id: u64,
    pub kind: String,
    pub source: String,
    pub label: String,
    pub preview: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSnapshot {
    pub request_id: u64,
    pub phase: String,
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staged: Option<StagedCaptureSnapshot>,
}

impl Default for CaptureSnapshot {
    fn default() -> Self {
        Self {
            request_id: 0,
            phase: "idle".into(),
            error: None,
            staged: None,
        }
    }
}

pub enum Control {
    Ask {
        text: String,
        display_text: String,
        cwd: PathBuf,
        run_id: u64,
        model: Option<String>,
        thinking_effort: Option<String>,
        capture: Option<CapturedImage>,
    },
    PermissionDecision {
        request_id: String,
        decision: PermissionDecision,
    },
    Stop,
    Close {
        claimed: Arc<AtomicBool>,
        finished: oneshot::Sender<()>,
    },
}

pub(crate) const MARKER_CLEAR_NOTICE: &str =
    "Recovery marker could not be cleared; a restart may report an interrupted request.";

pub(crate) fn mutate(updates: &watch::Sender<Snapshot>, action: impl FnOnce(&mut Snapshot)) {
    updates.send_modify(|snapshot| {
        action(snapshot);
        snapshot.seq = snapshot.seq.saturating_add(1);
    });
}
