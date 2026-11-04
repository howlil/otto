use super::runtime::ProviderId;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
#[cfg(windows)]
use std::sync::Arc;
#[cfg(windows)]
use std::sync::atomic::AtomicBool;
#[cfg(windows)]
use std::sync::atomic::Ordering;
#[cfg(windows)]
use std::time::Duration;
use tokio::sync::{oneshot, watch};
#[cfg(windows)]
use tokio::time::timeout;

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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderReadiness {
    pub status: String,
    pub message: String,
    pub recovery: String,

    pub image_input: bool,
    pub image_transport: bool,
    pub tool_free_admission: bool,
    pub model: Option<String>,
    pub models: Vec<ModelOption>,
    pub thinking_effort: Option<String>,
    pub thinking_efforts: Vec<String>,
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
            tool_free_admission: false,
            model: None,
            models: Vec::new(),
            thinking_effort: None,
            thinking_efforts: Vec::new(),
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
    pub messages: Vec<ChatMessage>,
    pub capture: CaptureSnapshot,
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSnapshot {
    pub request_id: u64,
    pub phase: String,
    pub error: Option<String>,
}

impl Default for CaptureSnapshot {
    fn default() -> Self {
        Self {
            request_id: 0,
            phase: "idle".into(),
            error: None,
        }
    }
}

#[cfg(windows)]
pub(crate) struct CaptureReservation(Arc<AtomicBool>);

#[cfg(windows)]
impl CaptureReservation {
    pub(crate) fn acquire(in_flight: Arc<AtomicBool>) -> Result<Self, String> {
        in_flight
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "Screen capture is already in progress.".to_string())?;
        Ok(Self(in_flight))
    }
}

#[cfg(windows)]
impl Drop for CaptureReservation {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[cfg(windows)]
pub(crate) async fn capture_with_deadline<F>(
    reservation: &Arc<CaptureReservation>,
    deadline: Duration,
    capture: F,
) -> Result<CapturedImage, String>
where
    F: FnOnce() -> Result<CapturedImage, String> + Send + 'static,
{
    let worker_reservation = Arc::clone(reservation);
    let worker = tauri::async_runtime::spawn_blocking(move || {
        let result = capture();
        drop(worker_reservation);
        result
    });
    match timeout(deadline, worker).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("Windows capture failed.".into()),
        Err(_) => Err(
            "Window capture timed out. Focus a responsive window and retry. If capture stays busy, restart Otto."
                .into(),
        ),
    }
}

pub struct CapturedImage(PathBuf);

impl CapturedImage {
    pub fn new(path: PathBuf) -> Self {
        Self(path)
    }
    pub fn path(&self) -> &std::path::Path {
        &self.0
    }
}

impl Drop for CapturedImage {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
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
