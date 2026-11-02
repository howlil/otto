#[cfg(windows)]
pub(crate) mod capture_context;
mod conversation;
mod error;
mod events;
pub(crate) mod history;
#[cfg(test)]
pub(crate) mod measurements;
mod policy;
mod providers;
mod readiness_probe;
mod recovery;
mod runtime;
use error::AgentError;
pub use runtime::ProviderId;
use runtime::SessionReuse;
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex as StdMutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};
use tauri::ipc::Channel;
use tokio::{
    sync::{Mutex, mpsc, oneshot, watch},
    time::timeout,
};

const MAX_PROMPT_BYTES: usize = 12_000;

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

fn default_workspace_path() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_default()
}

fn resolve_workspace_path(value: &str) -> PathBuf {
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
    pub model: Option<String>,
    pub models: Vec<ModelOption>,
    pub thinking_effort: Option<String>,
    pub thinking_efforts: Vec<String>,
}

#[derive(Clone, Default)]
struct ModelSelection {
    model: Option<String>,
    thinking_effort: Option<String>,
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
    fn acquire(in_flight: Arc<AtomicBool>) -> Result<Self, String> {
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
async fn capture_with_deadline<F>(
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

pub struct AgentRuntime {
    updates: watch::Sender<Snapshot>,
    control: Mutex<Option<mpsc::Sender<Control>>>,
    conversation: Arc<conversation::ConversationOwner>,
    selected_runtime: StdMutex<ModelSelection>,
    next_runtime_selection_id: AtomicU64,
    readiness_probes: StdMutex<readiness_probe::ReadinessProbeState>,
    active_run_readiness: StdMutex<Option<oneshot::Sender<()>>>,
    next_run_id: AtomicU64,
    subscriptions: StdMutex<Option<(u64, oneshot::Sender<()>)>>,
    next_subscription_id: AtomicU64,
    next_capture_id: AtomicU64,
    recovery: Option<recovery::RecoveryMarker>,
    #[cfg(windows)]
    capture_in_flight: Arc<AtomicBool>,
}

impl AgentRuntime {
    pub fn new() -> Self {
        Self::with_recovery(None, Arc::new(history::HistoryStore::memory()))
    }

    #[cfg(test)]
    pub fn persistent(path: PathBuf) -> Self {
        Self::with_recovery(
            Some(recovery::RecoveryMarker::new(path)),
            Arc::new(history::HistoryStore::memory()),
        )
    }

    pub fn persistent_with_history(marker: PathBuf, history_path: PathBuf) -> Self {
        Self::with_recovery(
            Some(recovery::RecoveryMarker::new(marker)),
            Arc::new(history::HistoryStore::file(history_path)),
        )
    }

    fn with_recovery(
        recovery: Option<recovery::RecoveryMarker>,
        history: Arc<history::HistoryStore>,
    ) -> Self {
        let interrupted = recovery
            .as_ref()
            .is_some_and(recovery::RecoveryMarker::take_interrupted);
        let cwd = default_workspace_path().to_string_lossy().into_owned();
        let conversation_id = history::new_id();
        let (updates, _) = watch::channel(Snapshot {
            run_id: 0,
            seq: u64::from(interrupted),
            status: if interrupted {
                RunPhase::Failed
            } else {
                RunPhase::Idle
            },
            provider: ProviderId::default(),
            cwd,
            conversation_id: conversation_id.clone(),
            thread_id: None,
            model: None,
            thinking_effort: None,
            usage: None,
            messages: Vec::new(),
            capture: CaptureSnapshot::default(),
            error: interrupted.then(|| {
                "Previous agent request may have been interrupted. No answer was restored. Ask again to start a new session.".into()
            }),
        });
        let conversation = Arc::new(conversation::ConversationOwner::new(history, conversation_id));
        Self {
            updates,
            control: Mutex::new(None),
            conversation,
            selected_runtime: StdMutex::new(ModelSelection::default()),
            next_runtime_selection_id: AtomicU64::new(0),
            readiness_probes: StdMutex::new(readiness_probe::ReadinessProbeState::default()),
            active_run_readiness: StdMutex::new(None),
            next_run_id: AtomicU64::new(0),
            subscriptions: StdMutex::new(None),
            next_subscription_id: AtomicU64::new(0),
            next_capture_id: AtomicU64::new(0),
            recovery,
            #[cfg(windows)]
            capture_in_flight: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn start_recovery_observer(&self) {
        let Some(marker) = self.recovery.clone() else {
            return;
        };
        let conversation = Arc::clone(&self.conversation);
        let mut receiver = self.updates.subscribe();
        let updates = self.updates.clone();
        tauri::async_runtime::spawn(async move {
            while receiver.changed().await.is_ok() {
                let snapshot = receiver.borrow_and_update().clone();
                persist_terminal_outcome(&conversation, &marker, &updates, &snapshot);
            }
        });
    }

    pub fn snapshot(&self) -> Snapshot {
        self.updates.borrow().clone()
    }

    pub fn history_list(&self) -> Result<Vec<history::ConversationSummary>, String> {
        self.conversation.history.list().map_err(String::from)
    }

    pub async fn history_open(&self, id: &str) -> Result<Snapshot, String> {
        self.conversation.history.open(id)?;
        self.new_session_with_timeout(Duration::from_secs(5))
            .await?;
        let guard = self.control.lock().await;
        let current = self.snapshot();
        if matches!(
            current.status,
            RunPhase::Starting | RunPhase::Streaming | RunPhase::Stopping
        ) || guard.as_ref().is_some_and(|sender| !sender.is_closed())
        {
            return Err("Stop the current request before opening a saved conversation.".into());
        }
        let record = self.conversation.history.open(id)?;
        let mut active_id = self
            .conversation.id
            .lock()
            .map_err(|_| AgentError::internal("Conversation history is unavailable."))?;
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
        drop(guard);
        Ok(self.snapshot())
    }

    pub fn history_rename(&self, id: &str, title: &str) -> Result<(), String> {
        self.conversation.history.rename(id, title).map_err(String::from)
    }

    pub async fn history_delete(&self, id: &str) -> Result<(), String> {
        if self.snapshot().conversation_id == id.trim() {
            self.new_session().await?;
        }
        self.conversation.history.delete(id).map_err(String::from)
    }

    fn persist_prompt(&self, run_id: u64, text: &str) -> Result<(), AgentError> {
        let mut snapshot = self.snapshot();
        snapshot.messages.push(ChatMessage {
            id: format!("{run_id}:user"),
            role: "user".into(),
            text: text.to_owned(),
        });
        self.conversation.persist_snapshot(&snapshot, true)
    }

    fn persist_current_snapshot(&self, interrupted: bool) -> Result<(), AgentError> {
        self.conversation
            .persist_snapshot(&self.snapshot(), interrupted)
    }

    pub fn subscribe(&self, channel: Channel<Snapshot>) -> u64 {
        let subscription_id = self.next_subscription_id.fetch_add(1, Ordering::Relaxed) + 1;
        let (cancel_tx, mut cancel_rx) = oneshot::channel();
        if let Ok(mut active) = self.subscriptions.lock()
            && let Some((_, previous)) = active.replace((subscription_id, cancel_tx))
        {
            let _ = previous.send(());
        }
        let mut rx = self.updates.subscribe();
        tauri::async_runtime::spawn(async move {
            if channel.send(rx.borrow_and_update().clone()).is_err() {
                return;
            }

            let mut cadence = tokio::time::interval(std::time::Duration::from_millis(50));
            cadence.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tokio::select! {
                    _ = &mut cancel_rx => break,
                    changed = rx.changed() => {
                        if changed.is_err() {
                            break;
                        }
                        cadence.tick().await;
                        if channel.send(rx.borrow_and_update().clone()).is_err() {
                            break;
                        }
                    }
                }
            }
        });
        subscription_id
    }

    pub fn unsubscribe(&self, subscription_id: u64) {
        let cancel = self.subscriptions.lock().ok().and_then(|mut active| {
            if active
                .as_ref()
                .is_some_and(|(active_id, _)| *active_id == subscription_id)
            {
                active.take().map(|(_, cancel)| cancel)
            } else {
                None
            }
        });
        if let Some(cancel) = cancel {
            let _ = cancel.send(());
        }
    }

    pub fn provider_installed(&self, provider: &str) -> bool {
        ProviderId::parse(provider).is_some_and(ProviderId::is_installed)
    }

    pub async fn select_provider(&self, provider: String) -> Result<(), String> {
        self.select_provider_with_timeout(provider, Duration::from_secs(5))
            .await
    }

    async fn select_provider_with_timeout(
        &self,
        provider: String,
        close_timeout: Duration,
    ) -> Result<(), String> {
        let provider = ProviderId::parse(&provider).ok_or("Unknown provider.")?;
        let mut guard = self.control.lock().await;
        let current = self.snapshot();
        if matches!(
            current.status,
            RunPhase::Starting | RunPhase::Streaming | RunPhase::Stopping
        ) || current.capture.phase != "idle"
        {
            return Err(
                "Finish or Stop the current answer or capture before changing provider.".into(),
            );
        }
        if current.provider == provider {
            return Ok(());
        }
        if let Some(sender) = guard.as_ref().filter(|sender| !sender.is_closed()) {
            close_owned_transport(sender, close_timeout).await?;
        }
        let latest = self.snapshot();
        if latest.capture.request_id != current.capture.request_id
            || latest.capture.phase != "idle"
        {
            *guard = None;
            mutate(&self.updates, |state| state.thread_id = None);
            return Err(
                "Screen capture started while changing provider. Retry after capture.".into(),
            );
        }

        let id_guard = self
            .conversation.id
            .lock()
            .map_err(|_| "Conversation history is unavailable.".to_string())?;
        let id = id_guard.clone();
        let mut switched = current.clone();
        switched.conversation_id = id.clone();
        switched.provider = provider;
        switched.thread_id = None;
        switched.model = None;
        switched.thinking_effort = None;
        switched.usage = None;
        switched.error = None;
        if let Some(record) =
            history::record_from_snapshot(&id, &switched, current.status != RunPhase::Completed)
        {
            if let Err(error) = self.conversation.history.upsert(record) {
                *guard = None;
                mutate(&self.updates, |state| {
                    state.thread_id = None;
                    state.error = Some(
                        "Conversation history could not be saved. The previous provider session was closed."
                            .into(),
                    );
                });
                return Err(String::from(error));
            }
        }

        *guard = None;
        *self.selected_runtime.lock().unwrap() = ModelSelection::default();
        self.next_run_id.fetch_max(current.run_id, Ordering::Relaxed);
        let next_run_id = self.next_run_id.fetch_add(1, Ordering::Relaxed) + 1;
        let marker_failed = self
            .recovery
            .as_ref()
            .is_some_and(|marker| marker.clear_if(current.run_id).is_err());
        mutate(&self.updates, |state| {
            if state.run_id == current.run_id {
                state.run_id = next_run_id;
                state.conversation_id = id;
                state.provider = provider;
                state.thread_id = None;
                state.model = None;
                state.thinking_effort = None;
                state.usage = None;
                state.error = marker_failed.then(|| MARKER_CLEAR_NOTICE.into());
            }
        });
        drop(id_guard);
        Ok(())
    }

    pub async fn select_runtime_options(
        &self,
        model: Option<String>,
        thinking_effort: Option<String>,
    ) -> Result<(), String> {
        let guard = self.control.lock().await;
        let current = self.snapshot();
        if !current.provider.capabilities().pending_model_selection {
            return Err("Pi runtime selection requires the Pi provider.".into());
        }
        if matches!(
            current.status,
            RunPhase::Starting | RunPhase::Streaming | RunPhase::Stopping
        ) || current.capture.phase != "idle"
        {
            return Err(
                "Finish the current request or capture before changing the Pi model.".into(),
            );
        }
        let selection_id = self
            .next_runtime_selection_id
            .fetch_add(1, Ordering::Relaxed)
            + 1;
        drop(guard);
        let readiness = self
            .provider_readiness_for(
                current.provider.as_str(),
                Some(&current.cwd),
                model.as_deref(),
            )
            .await;
        let _guard = self.control.lock().await;
        let latest = self.snapshot();
        if !runtime_selection_still_current(
            &current,
            &latest,
            selection_id,
            self.next_runtime_selection_id.load(Ordering::Relaxed),
        ) {
            return Err("Runtime selection changed while readiness was checked. Retry.".into());
        }
        if readiness.status != "ready" {
            return Err(format!("{} {}", readiness.message, readiness.recovery));
        }
        validate_runtime_options(&readiness, model.as_deref(), thinking_effort.as_deref())?;
        *self.selected_runtime.lock().unwrap() = ModelSelection {
            model,
            thinking_effort,
        };
        Ok(())
    }

    fn capture_runtime_options(&self, state: &Snapshot) -> ModelSelection {
        let previous = ModelSelection {
            model: state.model.clone(),
            thinking_effort: state.thinking_effort.clone(),
        };
        state
            .provider
            .options_for_capture(&previous, &self.selected_runtime.lock().unwrap())
    }

    pub async fn probe_provider_readiness(
        &self,
        request_id: u64,
        provider: &str,
        requested_cwd: Option<&str>,
        model: Option<&str>,
    ) -> Result<ProviderReadiness, String> {
        let mut cancelled = self
            .readiness_probes
            .lock()
            .map_err(|_| "Readiness controller unavailable.".to_string())?
            .begin(request_id)?;
        let result = tokio::select! {
            _ = &mut cancelled => Err("Readiness probe cancelled.".to_string()),
            readiness = self.provider_readiness_for(provider, requested_cwd, model) => Ok(readiness),
        };
        if let Ok(mut probes) = self.readiness_probes.lock() {
            probes.finish(request_id);
        }
        result
    }

    pub fn cancel_provider_readiness(&self, request_id: u64) {
        if let Ok(mut probes) = self.readiness_probes.lock() {
            probes.cancel(request_id);
        }
    }

    fn begin_run_readiness(&self) -> Result<oneshot::Receiver<()>, String> {
        let mut active = self
            .active_run_readiness
            .lock()
            .map_err(|_| "Readiness controller unavailable.".to_string())?;
        if active.is_some() {
            return Err("Another agent readiness check is already running.".into());
        }
        let (cancel, cancelled) = oneshot::channel();
        *active = Some(cancel);
        Ok(cancelled)
    }

    fn finish_run_readiness(&self) {
        if let Ok(mut active) = self.active_run_readiness.lock() {
            *active = None;
        }
    }

    fn cancel_run_readiness(&self) -> bool {
        let cancel = self
            .active_run_readiness
            .lock()
            .ok()
            .and_then(|mut active| active.take());
        if let Some(cancel) = cancel {
            let _ = cancel.send(());
            true
        } else {
            false
        }
    }

    fn fail_starting_run<T>(&self, run_id: u64, error: &AgentError) -> Result<T, String> {
        let marker_failed = self
            .recovery
            .as_ref()
            .is_some_and(|marker| marker.clear_if(run_id).is_err());
        let message = append_notice(&error.to_string(), marker_failed);
        mutate(&self.updates, |state| {
            if state.run_id == run_id && state.status == RunPhase::Starting {
                state.status = RunPhase::Failed;
                state.error = Some(message.clone());
                state.capture = CaptureSnapshot::default();
            }
        });
        Err(message)
    }

    pub async fn provider_readiness(
        &self,
        provider: &str,
        requested_cwd: Option<&str>,
    ) -> ProviderReadiness {
        self.provider_readiness_for(provider, requested_cwd, None)
            .await
    }

    pub async fn provider_readiness_for(
        &self,
        provider: &str,
        requested_cwd: Option<&str>,
        model: Option<&str>,
    ) -> ProviderReadiness {
        let Some(provider_id) = ProviderId::parse(provider) else {
            return ProviderReadiness::new(
                "unsupported",
                "Provider adapter unavailable.",
                "Choose a supported provider.",
            );
        };
        let snapshot = self.snapshot();
        let directory = requested_cwd
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(&snapshot.cwd);
        let Ok(cwd) = std::fs::canonicalize(resolve_workspace_path(directory)) else {
            return ProviderReadiness::new(
                "unavailable",
                "Working project folder does not exist.",
                "Select a valid folder, then Retry.",
            );
        };
        if !cwd.is_dir() {
            return ProviderReadiness::new(
                "unavailable",
                "Working project must be a folder.",
                "Select a valid folder, then Retry.",
            );
        }
        provider_id.readiness(&cwd, model).await
    }

    #[cfg(windows)]
    pub(crate) fn begin_capture(&self) -> Result<(u64, CaptureReservation), String> {
        if matches!(
            self.snapshot().status,
            RunPhase::Starting | RunPhase::Streaming | RunPhase::Stopping
        ) {
            return Err("Finish or Stop the current answer before capturing.".into());
        }
        let reservation = CaptureReservation::acquire(Arc::clone(&self.capture_in_flight))?;
        let request_id = self.next_capture_id.fetch_add(1, Ordering::Relaxed) + 1;
        mutate(&self.updates, |state| {
            state.capture = CaptureSnapshot {
                request_id,
                phase: "preparing".into(),
                error: None,
            };
        });
        Ok((request_id, reservation))
    }

    #[cfg(windows)]
    pub(crate) async fn capture_hotkey<F>(
        &self,
        request_id: u64,
        _reservation: CaptureReservation,
        capture: F,
    ) -> Result<(), String>
    where
        F: FnOnce() -> Result<CapturedImage, String> + Send + 'static,
    {
        let state = self.snapshot();
        if state.capture.request_id != request_id || state.capture.phase != "preparing" {
            return Err("Capture request is no longer current.".into());
        }
        if matches!(
            state.status,
            RunPhase::Starting | RunPhase::Streaming | RunPhase::Stopping
        ) {
            return Err("Finish or Stop the current answer before capturing.".into());
        }
        if let Some(reason) = state.provider.capture_unavailable_reason() {
            return Err(reason.into());
        }
        let selected = self.capture_runtime_options(&state);
        let ready = self
            .provider_readiness_for(
                state.provider.as_str(),
                Some(&state.cwd),
                selected.model.as_deref(),
            )
            .await;
        if ready.status != "ready" || !ready.image_input {
            return Err(
                "Selected provider or model cannot accept screenshots. Open Agent settings and Retry."
                    .into(),
            );
        }
        mutate(&self.updates, |state| {
            if state.capture.request_id == request_id {
                state.capture.phase = "capturing".into();
            }
        });
        let reservation = Arc::new(_reservation);
        let image = capture_with_deadline(&reservation, Duration::from_secs(8), capture).await?;
        mutate(&self.updates, |state| {
            if state.capture.request_id == request_id {
                state.capture.phase = "submitting".into();
            }
        });
        self.ask_with_capture(
            "Analyze the captured application window. Describe what is visible and answer any apparent question without modifying files.".into(),
            state.cwd,
            state.provider.as_str().into(),
            selected,
            Some(image),
        ).await.map(|_| ())
    }

    #[cfg(windows)]
    pub fn capture_error(&self, reason: &str) {
        self.set_capture_error(None, reason);
    }

    #[cfg(windows)]
    pub(crate) fn capture_error_for(&self, request_id: u64, reason: &str) {
        self.set_capture_error(Some(request_id), reason);
    }

    #[cfg(windows)]
    fn set_capture_error(&self, request_id: Option<u64>, reason: &str) {
        if reason == "Screen capture is already in progress." {
            return;
        }
        mutate(&self.updates, |s| {
            if request_id.is_some_and(|id| s.capture.request_id != id) {
                return;
            }
            if !matches!(
                s.status,
                RunPhase::Starting | RunPhase::Streaming | RunPhase::Stopping
            ) && (s.status != RunPhase::Failed
                || s.error
                    .as_deref()
                    .is_some_and(|error| error.starts_with("Capture: "))
                || s.error.is_none())
            {
                s.capture.phase = "failed".into();
                s.capture.error = Some(reason.to_owned());
                s.error = Some(format!("Capture: {reason}"));
            }
        });
    }

    #[cfg(windows)]
    pub fn clear_capture_error(&self) {
        mutate(&self.updates, |s| {
            if s.error
                .as_deref()
                .is_some_and(|error| error.starts_with("Capture: "))
            {
                s.capture = CaptureSnapshot::default();
                s.error = None;
            }
        });
    }

    pub async fn ask(
        &self,
        text: String,
        provider: String,
        model: Option<String>,
        thinking_effort: Option<String>,
    ) -> Result<AcceptedRun, String> {
        self.ask_with_capture(
            text,
            default_workspace_path().to_string_lossy().into_owned(),
            provider,
            ModelSelection {
                model,
                thinking_effort,
            },
            None,
        )
        .await
    }

    async fn ask_with_capture(
        &self,
        text: String,
        cwd: String,
        provider: String,
        selection: ModelSelection,
        capture: Option<CapturedImage>,
    ) -> Result<AcceptedRun, String> {
        let ModelSelection {
            model,
            thinking_effort,
        } = selection;
        let text = validate_prompt(&text)?;
        let selected = ProviderId::parse(&provider).ok_or("Selected provider is unavailable.")?;
        selected.validate(capture.is_some())?;
        let capture_origin = capture.is_some();
        let cwd = std::fs::canonicalize(resolve_workspace_path(&cwd))
            .map_err(|_| "Working folder does not exist.".to_string())?;
        if !cwd.is_dir() {
            return Err("Working context must be a folder.".into());
        }
        let mut guard = self.control.lock().await;
        let current = self.snapshot();
        if matches!(
            current.status,
            RunPhase::Starting | RunPhase::Streaming | RunPhase::Stopping
        ) {
            return Err("An answer is already running.".into());
        }
        if current.provider != selected {
            return Err(
                "Select the provider in Agent Settings before requesting an answer.".into(),
            );
        }
        if current.status == RunPhase::Completed {
            self.persist_current_snapshot(false).map_err(String::from)?;
        }

        let provider_has_context =
            guard.as_ref().is_some_and(|sender| !sender.is_closed()) && current.thread_id.is_some();
        let reusable_followup = guard.as_ref().is_some_and(|sender| !sender.is_closed())
            && selected.can_reuse_without_probe(&SessionReuse::for_turn(
                &current,
                &cwd,
                model.as_deref(),
                thinking_effort.as_deref(),
                capture.is_some(),
            ));
        let provider_text = if provider_has_context {
            text.clone()
        } else {
            contextual_prompt(&current.messages, &text)
        };
        let reserved_run_id = if reusable_followup {
            None
        } else {
            let run_id = self.next_run_id.fetch_add(1, Ordering::Relaxed) + 1;
            if let Some(marker) = &self.recovery {
                marker.mark(run_id)?;
            }
            let cancelled = self.begin_run_readiness()?;
            mutate(&self.updates, |s| {
                s.run_id = run_id;
                s.status = RunPhase::Starting;
                s.provider = selected;
                s.capture.phase = if capture_origin { "analyzing" } else { "idle" }.into();
                s.capture.error = None;
                s.error = None;
                s.cwd = cwd.to_string_lossy().into_owned();
                if !provider_has_context {
                    s.thread_id = None;
                }
                s.model = model.clone();
                s.thinking_effort = thinking_effort.clone();
                s.usage = None;
            });
            drop(guard);
            let requested_cwd = cwd.to_string_lossy().into_owned();
            let readiness = tokio::select! {
                _ = cancelled => Err(AgentError::cancelled("Readiness probe cancelled.")),
                readiness = self.provider_readiness_for(
                    selected.as_str(),
                    Some(&requested_cwd),
                    model.as_deref(),
                ) => Ok(readiness),
            };
            guard = self.control.lock().await;
            self.finish_run_readiness();
            let latest = self.snapshot();
            if latest.run_id != run_id || latest.status != RunPhase::Starting {
                return Err("Agent readiness was stopped or superseded.".into());
            }
            let readiness = match readiness {
                Ok(readiness) => readiness,
                Err(error) => {
                    return self.fail_starting_run(run_id, &error);
                }
            };
            if readiness.status != "ready" {
                return self.fail_starting_run(
                    run_id,
                    &AgentError::readiness_failed(format!(
                        "{} {}",
                        readiness.message, readiness.recovery
                    )),
                );
            }
            if capture.is_some() && !readiness.image_input {
                return self.fail_starting_run(
                    run_id,
                    &AgentError::invalid_request(
                        "The selected provider model cannot accept an image.",
                    ),
                );
            }
            if let Err(error) =
                validate_runtime_options(&readiness, model.as_deref(), thinking_effort.as_deref())
            {
                return self.fail_starting_run(run_id, &AgentError::invalid_request(error));
            }
            if selected.capabilities().pending_model_selection {
                *self.selected_runtime.lock().unwrap() = ModelSelection {
                    model: model.clone(),
                    thinking_effort: thinking_effort.clone(),
                };
            }
            Some(run_id)
        };
        if let Some(sender) = guard.as_ref().filter(|tx| !tx.is_closed()) {
            if std::path::Path::new(&current.cwd) != cwd.as_path() {
                return Err(
                    "Working context is fixed for this conversation. Restart Otto to change it."
                        .into(),
                );
            }

            if current.provider != selected {
                return Err("Provider is fixed for the conversation. Start a new session.".into());
            }
            let run_id = self.next_run_id.fetch_add(1, Ordering::Relaxed) + 1;
            let permit = sender
                .try_reserve()
                .map_err(|_| "Agent provider is busy. Try again.".to_string())?;

            if let Some(marker) = &self.recovery {
                marker.mark(run_id)?;
            }
            if selected.capabilities().pending_model_selection {
                *self.selected_runtime.lock().unwrap() = ModelSelection {
                    model: model.clone(),
                    thinking_effort: thinking_effort.clone(),
                };
            }
            mutate(&self.updates, |s| {
                s.run_id = run_id;
                s.status = RunPhase::Starting;
                s.capture.phase = if capture_origin { "analyzing" } else { "idle" }.into();
                s.capture.error = None;
                s.error = None;
                s.model = model.clone();
                s.thinking_effort = thinking_effort.clone();
                s.usage = None;
            });
            if let Err(error) = self.persist_prompt(run_id, &text) {
                return self.fail_starting_run(run_id, &error);
            }
            permit.send(Control::Ask {
                text: provider_text,
                display_text: text,
                cwd,
                run_id,
                model,
                thinking_effort,
                capture,
            });
            return Ok(AcceptedRun { run_id });
        }
        let run_id = reserved_run_id.ok_or("Agent run reservation is missing.")?;
        if let Err(error) = self.persist_prompt(run_id, &text) {
            return self.fail_starting_run(run_id, &error);
        }
        let (tx, rx) = mpsc::channel(4);
        let events = events::ProviderEvents::new(self.updates.clone());
        tauri::async_runtime::spawn(async move {
            let initial = Control::Ask {
                text: provider_text,
                display_text: text,
                cwd,
                run_id,
                model,
                thinking_effort,
                capture,
            };
            selected.run(rx, events, initial).await;
        });
        *guard = Some(tx);
        Ok(AcceptedRun { run_id })
    }

    pub async fn new_session(&self) -> Result<(), String> {
        self.new_session_with_timeout(Duration::from_secs(5)).await
    }

    async fn new_session_with_timeout(&self, close_timeout: Duration) -> Result<(), String> {
        let mut guard = self.control.lock().await;
        let current = self.snapshot();
        if matches!(
            current.status,
            RunPhase::Starting | RunPhase::Streaming | RunPhase::Stopping
        ) {
            return Err("Stop the current request before starting a new session.".into());
        }
        if !matches!(current.capture.phase.as_str(), "idle" | "failed") {
            return Err("Finish screen capture before starting a new session.".into());
        }

        if let Some(sender) = guard.as_ref().filter(|sender| !sender.is_closed()) {
            close_owned_transport(sender, close_timeout).await?;
        }
        self.persist_current_snapshot(current.status != RunPhase::Completed)?;
        *guard = None;
        *self.selected_runtime.lock().unwrap() = ModelSelection::default();
        let clear_failed = self
            .recovery
            .as_ref()
            .is_some_and(|marker| marker.clear_if(current.run_id).is_err());
        self.next_run_id
            .fetch_max(current.run_id, Ordering::Relaxed);
        let run_id = self.next_run_id.fetch_add(1, Ordering::Relaxed) + 1;
        let next_conversation = history::new_id();
        let mut id = self
            .conversation
            .id
            .lock()
            .map_err(|_| "Conversation history is unavailable.")?;
        *id = next_conversation.clone();
        mutate(&self.updates, |s| {
            s.run_id = run_id;
            s.status = RunPhase::Idle;
            s.provider = current.provider;
            s.conversation_id = next_conversation;
            s.thread_id = None;
            s.model = None;
            s.thinking_effort = None;
            s.usage = None;
            s.messages.clear();
            s.capture = CaptureSnapshot::default();
            s.error = clear_failed.then(|| MARKER_CLEAR_NOTICE.into());
        });
        drop(id);
        Ok(())
    }

    pub async fn stop(&self) -> Result<(), String> {
        let guard = self.control.lock().await;
        let status = self.snapshot().status;
        if status == RunPhase::Stopping {
            return Ok(());
        }
        if !matches!(status, RunPhase::Starting | RunPhase::Streaming) {
            return Err("No active agent turn.".into());
        }
        if status == RunPhase::Starting && guard.is_none() && self.cancel_run_readiness() {
            let run_id = self.snapshot().run_id;
            let clear_failed = self
                .recovery
                .as_ref()
                .is_some_and(|marker| marker.clear_if(run_id).is_err());
            mutate(&self.updates, |state| {
                if state.run_id == run_id && state.status == RunPhase::Starting {
                    state.status = RunPhase::Stopped;
                    state.capture = CaptureSnapshot::default();
                    if clear_failed {
                        state.error = Some(MARKER_CLEAR_NOTICE.into());
                    }
                }
            });
            return Ok(());
        }
        let sender = guard.as_ref().ok_or("No active agent process.")?;
        let permit = sender
            .try_reserve()
            .map_err(|_| "Agent is busy; retry Stop.".to_string())?;

        mutate(&self.updates, |s| {
            if matches!(s.status, RunPhase::Starting | RunPhase::Streaming) {
                s.status = RunPhase::Stopping;
            }
        });
        permit.send(Control::Stop);
        Ok(())
    }
}

async fn close_owned_transport(
    sender: &mpsc::Sender<Control>,
    close_timeout: Duration,
) -> Result<(), String> {
    let (finished, mut closed) = oneshot::channel();
    let claimed = Arc::new(AtomicBool::new(false));
    sender
        .try_send(Control::Close {
            claimed: Arc::clone(&claimed),
            finished,
        })
        .map_err(|_| "Agent provider is busy. Try again.".to_string())?;
    match timeout(close_timeout, &mut closed).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(_)) => Err("Agent closed unexpectedly; session was not reset.".into()),
        Err(_) if !claimed.swap(true, Ordering::SeqCst) => {
            Err("Agent did not accept session close; session was not reset.".into())
        }
        Err(_) => Err("Agent is still closing; session was not reset.".into()),
    }
}

const MARKER_CLEAR_NOTICE: &str =
    "Recovery marker could not be cleared; a restart may report an interrupted request.";

fn append_notice(message: &str, marker_failed: bool) -> String {
    if marker_failed {
        format!("{message} {MARKER_CLEAR_NOTICE}")
    } else {
        message.to_owned()
    }
}

fn persist_terminal_outcome(
    conversation: &conversation::ConversationOwner,
    marker: &recovery::RecoveryMarker,
    updates: &watch::Sender<Snapshot>,
    snapshot: &Snapshot,
) {
    if !matches!(
        snapshot.status,
        RunPhase::Completed | RunPhase::Failed | RunPhase::Stopped
    ) || updates.borrow().run_id != snapshot.run_id
    {
        return;
    }
    let interrupted = snapshot.status != RunPhase::Completed;
    let stored = match conversation.id.lock() {
        Ok(id)
            if updates.borrow().run_id == snapshot.run_id
                && updates.borrow().conversation_id == *id
                && snapshot.conversation_id == *id =>
        {
            let record = history::record_from_snapshot(&id, snapshot, interrupted);
            match record {
                Some(record) => conversation.history.upsert(record),
                None => Ok(()),
            }
        }
        Ok(_) => return,
        Err(_) => Err(AgentError::internal("Conversation history is unavailable.")),
    };
    let mut notices: Vec<String> = Vec::new();
    if stored.is_err() {
        notices.push(
            "Conversation history could not be saved; a restart may not restore this conversation."
                .into(),
        );
    }
    if stored.is_ok() && marker.clear_if(snapshot.run_id).is_err() {
        notices.push(MARKER_CLEAR_NOTICE.into());
    }
    if !notices.is_empty() {
        let notice = notices.join(" ");
        mutate(updates, |state| {
            if state.run_id == snapshot.run_id {
                state.error = Some(match state.error.take() {
                    Some(existing) => format!("{existing} {notice}"),
                    None => notice,
                });
            }
        });
    }
}

fn runtime_selection_still_current(
    previous: &Snapshot,
    latest: &Snapshot,
    selection_id: u64,
    newest_selection_id: u64,
) -> bool {
    selection_id == newest_selection_id
        && latest.run_id == previous.run_id
        && latest.provider == previous.provider
        && latest.conversation_id == previous.conversation_id
        && latest.cwd == previous.cwd
        && latest.status == previous.status
        && latest.capture.request_id == previous.capture.request_id
        && latest.capture.phase == "idle"
}

fn validate_runtime_options(
    readiness: &ProviderReadiness,
    model: Option<&str>,
    thinking_effort: Option<&str>,
) -> Result<(), String> {
    if let Some(model) = model {
        let selected = readiness
            .models
            .iter()
            .find(|option| option.id == model)
            .ok_or("Selected model is not available from the provider catalog.")?;
        if let Some(effort) = thinking_effort
            && !selected
                .thinking_efforts
                .iter()
                .any(|value| value == effort)
        {
            return Err("Selected thinking effort is not supported by the model.".into());
        }
    } else if let Some(effort) = thinking_effort
        && !readiness
            .thinking_efforts
            .iter()
            .any(|value| value == effort)
    {
        return Err("Selected thinking effort is not supported by the provider.".into());
    }
    Ok(())
}

fn validate_prompt(text: &str) -> Result<String, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_PROMPT_BYTES {
        return Err("Enter a question (up to 12,000 bytes).".into());
    }
    Ok(trimmed.to_owned())
}

fn contextual_prompt(messages: &[ChatMessage], text: &str) -> String {
    if messages.is_empty() {
        return text.to_owned();
    }
    let header = "Previous Otto conversation:\n";
    let question_header = "\nNew user question:\n";
    let mut remaining = 48_000usize.saturating_sub(
        header
            .len()
            .saturating_add(question_header.len())
            .saturating_add(text.len()),
    );
    let mut selected = Vec::new();
    for message in messages.iter().rev().take(12) {
        let role = if message.role == "user" {
            "User"
        } else {
            "Otto"
        };
        let entry = format!("{role}: {}\n", message.text);
        if entry.len() > remaining {
            break;
        }
        remaining -= entry.len();
        selected.push(entry);
    }
    let mut context = String::from(header);
    for entry in selected.into_iter().rev() {
        context.push_str(&entry);
    }
    context.push_str(question_header);
    context.push_str(text);
    context
}

pub(crate) fn mutate(updates: &watch::Sender<Snapshot>, action: impl FnOnce(&mut Snapshot)) {
    updates.send_modify(|snapshot| {
        action(snapshot);
        snapshot.seq = snapshot.seq.saturating_add(1);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn prompt_validation_trims_and_enforces_byte_limit() {
        assert_eq!(validate_prompt("  explain this  ").unwrap(), "explain this");
        assert!(validate_prompt("   ").is_err());
        assert!(validate_prompt(&"a".repeat(MAX_PROMPT_BYTES)).is_ok());
        assert!(validate_prompt(&"a".repeat(MAX_PROMPT_BYTES + 1)).is_err());
        assert!(validate_prompt(&"🙂".repeat(MAX_PROMPT_BYTES / 4 + 1)).is_err());
    }

    #[test]
    fn captured_image_removes_its_temporary_file_when_dropped() {
        let path = std::env::temp_dir().join(format!(
            "otto-capture-lifetime-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(&path, b"capture").unwrap();
        let image = CapturedImage::new(path.clone());
        assert!(path.is_file());
        drop(image);
        assert!(!path.exists());
    }

    #[test]
    fn persistent_runtime_reports_interrupted_startup_without_restoring_answer() {
        let marker_path = std::env::temp_dir().join(format!(
            "otto-runtime-recovery-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = AgentRuntime::persistent(marker_path.clone());
        runtime.recovery.as_ref().unwrap().mark(42).unwrap();
        drop(runtime);

        let restarted = AgentRuntime::persistent(marker_path.clone());
        let snapshot = restarted.snapshot();
        assert_eq!(snapshot.status, "failed");
        assert!(snapshot.messages.is_empty());
        assert!(snapshot.thread_id.is_none());
        assert!(snapshot.error.as_deref().unwrap().contains("interrupted"));
        assert!(!marker_path.exists());
    }

    #[tokio::test]
    async fn switching_completed_provider_keeps_conversation_and_closes_native_transport() {
        let root = std::env::temp_dir().join(format!(
            "otto-provider-switch-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let history_path = root.join("conversations.json");
        let runtime =
            AgentRuntime::persistent_with_history(root.join("marker"), history_path.clone());
        let (sender, mut receiver) = mpsc::channel(2);
        *runtime.control.lock().await = Some(sender);
        mutate(&runtime.updates, |state| {
            state.status = RunPhase::Completed;
            state.run_id = 7;
            state.thread_id = Some("native-codex-thread".into());
            state.model = Some("old-model".into());
            state.messages = vec![
                ChatMessage {
                    id: "7:user".into(),
                    role: "user".into(),
                    text: "Explain ownership".into(),
                },
                ChatMessage {
                    id: "7:assistant".into(),
                    role: "assistant".into(),
                    text: "Ownership controls lifetime.".into(),
                },
            ];
        });
        let before = runtime.snapshot();
        let worker = tokio::spawn(async move {
            let Some(Control::Close { claimed, finished }) = receiver.recv().await else {
                panic!("native transport must be closed before provider changes");
            };
            assert!(!claimed.swap(true, Ordering::SeqCst));
            finished.send(()).unwrap();
        });
        runtime.select_provider("pi".into()).await.unwrap();
        worker.await.unwrap();
        let after = runtime.snapshot();
        assert_eq!(after.conversation_id, before.conversation_id);
        assert_eq!(after.messages.len(), 2);
        assert_eq!(after.provider, ProviderId::Pi);
        assert!(after.thread_id.is_none());
        assert!(after.model.is_none());
        assert!(after.usage.is_none());
        assert!(after.run_id > before.run_id);
        assert!(runtime.control.lock().await.is_none());
        let saved = runtime.conversation.history.open(&after.conversation_id).unwrap();
        assert_eq!(saved.provider, ProviderId::Pi);
        assert_eq!(saved.messages[1].text, "Ownership controls lifetime.");
        let raw = std::fs::read_to_string(history_path).unwrap();
        assert!(!raw.contains("native-codex-thread"));
        assert!(!raw.contains("cwd"));
        assert!(contextual_prompt(&after.messages, "What about borrowing?")
            .contains("Otto: Ownership controls lifetime."));
        let restarted = AgentRuntime::persistent_with_history(
            root.join("marker2"),
            root.join("conversations.json"),
        );
        let reopened = restarted
            .history_open(&after.conversation_id)
            .await
            .unwrap();
        assert_eq!(reopened.provider, ProviderId::Pi);
        assert!(reopened.thread_id.is_none());
        assert_eq!(reopened.messages.len(), 2);
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn switching_provider_rejects_active_turn_and_capture() {
        let runtime = AgentRuntime::new();
        for status in [RunPhase::Starting, RunPhase::Streaming, RunPhase::Stopping] {
            mutate(&runtime.updates, |state| state.status = status);
            assert!(runtime.select_provider("pi".into()).await.is_err());
            assert_eq!(runtime.snapshot().provider, ProviderId::Codex);
        }
        mutate(&runtime.updates, |state| {
            state.status = RunPhase::Completed;
            state.capture.phase = "preparing".into();
        });
        assert!(runtime.select_provider("pi".into()).await.is_err());
        assert_eq!(runtime.snapshot().provider, ProviderId::Codex);
    }

    #[tokio::test]
    async fn failed_provider_close_does_not_discard_current_session() {
        let runtime = AgentRuntime::new();
        let (sender, receiver) = mpsc::channel(2);
        *runtime.control.lock().await = Some(sender);
        mutate(&runtime.updates, |state| {
            state.status = RunPhase::Completed;
            state.thread_id = Some("still-owned".into());
        });
        let before = runtime.snapshot();
        let result = runtime
            .select_provider_with_timeout("pi".into(), Duration::from_millis(10))
            .await;
        assert!(result.is_err());
        let after = runtime.snapshot();
        assert_eq!(after.provider, before.provider);
        assert_eq!(after.conversation_id, before.conversation_id);
        assert_eq!(after.thread_id, before.thread_id);
        assert_eq!(after.run_id, before.run_id);
        drop(receiver);
    }

    #[tokio::test]
    async fn history_failure_after_close_clears_native_identity_without_changing_provider() {
        let root = std::env::temp_dir().join(format!(
            "otto-switch-save-failure-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let blocker = root.join("not-a-directory");
        std::fs::write(&blocker, b"blocked").unwrap();
        let runtime = AgentRuntime::persistent_with_history(
            root.join("marker"),
            blocker.join("conversations.json"),
        );
        let (sender, mut receiver) = mpsc::channel(2);
        *runtime.control.lock().await = Some(sender);
        mutate(&runtime.updates, |state| {
            state.status = RunPhase::Completed;
            state.thread_id = Some("native-session".into());
            state.messages.push(ChatMessage {
                id: "1:user".into(),
                role: "user".into(),
                text: "Original question".into(),
            });
        });
        let before = runtime.snapshot();
        let worker = tokio::spawn(async move {
            let Some(Control::Close { claimed, finished }) = receiver.recv().await else {
                panic!("close request expected");
            };
            assert!(!claimed.swap(true, Ordering::SeqCst));
            finished.send(()).unwrap();
        });
        assert!(runtime.select_provider("pi".into()).await.is_err());
        worker.await.unwrap();
        let after = runtime.snapshot();
        assert_eq!(after.provider, ProviderId::Codex);
        assert_eq!(after.conversation_id, before.conversation_id);
        assert_eq!(after.messages[0].text, "Original question");
        assert!(after.thread_id.is_none());
        assert!(runtime.control.lock().await.is_none());
        assert!(after.error.as_deref().unwrap().contains("could not be saved"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn capture_started_during_close_prevents_provider_switch() {
        let runtime = AgentRuntime::new();
        let (sender, mut receiver) = mpsc::channel(2);
        *runtime.control.lock().await = Some(sender);
        mutate(&runtime.updates, |state| {
            state.status = RunPhase::Completed;
            state.thread_id = Some("old-session".into());
        });
        let (received, acknowledged) = oneshot::channel();
        let (release, proceed) = oneshot::channel();
        let worker = tokio::spawn(async move {
            let Some(Control::Close { claimed, finished }) = receiver.recv().await else {
                panic!("close request expected");
            };
            assert!(!claimed.swap(true, Ordering::SeqCst));
            received.send(()).unwrap();
            proceed.await.unwrap();
            finished.send(()).unwrap();
        });
        let switch = runtime.select_provider("pi".into());
        tokio::pin!(switch);
        tokio::select! {
            result = &mut switch => panic!("switch completed before close: {result:?}"),
            result = acknowledged => assert!(result.is_ok()),
        }
        mutate(&runtime.updates, |state| {
            state.capture.request_id = 1;
            state.capture.phase = "preparing".into();
        });
        release.send(()).unwrap();
        assert!(switch.await.is_err());
        worker.await.unwrap();
        let state = runtime.snapshot();
        assert_eq!(state.provider, ProviderId::Codex);
        assert!(state.thread_id.is_none());
        assert_eq!(state.capture.phase, "preparing");
    }

    #[test]
    fn stale_terminal_observer_does_not_overwrite_new_provider_history() {
        let root = std::env::temp_dir().join(format!(
            "otto-stale-switch-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = AgentRuntime::persistent_with_history(
            root.join("marker"),
            root.join("conversations.json"),
        );
        runtime.recovery.as_ref().unwrap().mark(3).unwrap();
        let mut old = runtime.snapshot();
        old.run_id = 3;
        old.status = RunPhase::Completed;
        old.messages = vec![ChatMessage {
            id: "3:user".into(),
            role: "user".into(),
            text: "old".into(),
        }];
        mutate(&runtime.updates, |state| state.run_id = 4);
        persist_terminal_outcome(
            &runtime.conversation,
            runtime.recovery.as_ref().unwrap(),
            &runtime.updates,
            &old,
        );
        assert!(runtime.conversation.history.list().unwrap().is_empty());
        assert_eq!(std::fs::read_to_string(root.join("marker")).unwrap(), "3");
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn completed_agy_followup_uses_owned_runtime_without_reprobing_cli() {
        let runtime = AgentRuntime::new();
        runtime.select_provider("agy".into()).await.unwrap();
        let cwd = std::fs::canonicalize(default_workspace_path()).unwrap();
        mutate(&runtime.updates, |state| {
            state.status = "completed".into();
            state.thread_id = Some("agy-conversation".into());
            state.cwd = cwd.to_string_lossy().into_owned();
        });
        let (sender, mut receiver) = mpsc::channel(2);
        *runtime.control.lock().await = Some(sender);
        runtime
            .ask("continue the explanation".into(), "agy".into(), None, None)
            .await
            .expect("a completed Agy conversation must not require another CLI probe");
        assert!(matches!(receiver.try_recv(), Ok(Control::Ask { .. })));
        assert_eq!(runtime.snapshot().status, "starting");
    }

    #[test]
    fn typed_run_contract_preserves_ipc_wire_values() {
        assert_eq!(serde_json::to_string(&ProviderId::Pi).unwrap(), "\"pi\"");
        assert_eq!(
            serde_json::to_string(&AcceptedRun { run_id: 42 }).unwrap(),
            "{\"runId\":42}"
        );
    }

    #[test]
    fn public_snapshot_excludes_workspace_and_tool_control_fields() {
        let runtime = AgentRuntime::new();
        let value = serde_json::to_value(runtime.snapshot()).unwrap();
        let object = value.as_object().unwrap();
        assert!(!object.contains_key("mode"));
        assert!(!object.contains_key("cwd"));
    }

    #[tokio::test]
    async fn opened_history_becomes_the_active_conversation_in_snapshot() {
        let root = std::env::temp_dir().join(format!(
            "otto-open-history-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = AgentRuntime::persistent_with_history(
            root.join("marker"),
            root.join("conversations.json"),
        );
        runtime.persist_prompt(7, "First conversation").unwrap();
        let original = runtime.snapshot().conversation_id;
        assert!(!original.is_empty());

        let opened = runtime.conversation.history.list().unwrap();
        assert_eq!(opened.len(), 1);
        let snapshot = runtime
            .history_open(&opened[0].id)
            .await
            .expect("saved conversation opens");
        assert_eq!(snapshot.conversation_id, opened[0].id);
        assert_eq!(snapshot.messages.len(), 1);
        assert_eq!(snapshot.messages[0].text, "First conversation");
        assert_eq!(snapshot.provider, "codex");
        assert_eq!(runtime.snapshot().conversation_id, opened[0].id);
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn reopening_current_history_uses_latest_persisted_transcript() {
        let root = std::env::temp_dir().join(format!(
            "otto-history-refresh-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = AgentRuntime::persistent_with_history(
            root.join("marker"),
            root.join("conversations.json"),
        );
        runtime.persist_prompt(7, "Original question").unwrap();
        let id = runtime.snapshot().conversation_id;
        assert_eq!(runtime.conversation.history.open(&id).unwrap().messages.len(), 1);
        mutate(&runtime.updates, |state| {
            state.run_id = 7;
            state.status = RunPhase::Completed;
            state.messages = vec![
                ChatMessage {
                    id: "7:user".into(),
                    role: "user".into(),
                    text: "Original question".into(),
                },
                ChatMessage {
                    id: "7:assistant".into(),
                    role: "assistant".into(),
                    text: "Latest completed answer".into(),
                },
            ];
        });

        let reopened = runtime.history_open(&id).await.unwrap();
        assert_eq!(reopened.conversation_id, id);
        assert_eq!(reopened.messages.len(), 2);
        assert_eq!(reopened.messages[1].text, "Latest completed answer");
        assert_eq!(
            runtime.conversation.history.open(&id).unwrap().messages[1].text,
            "Latest completed answer"
        );
        assert!(reopened.thread_id.is_none());
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn new_session_clears_provider_selection_and_usage() {
        let runtime = AgentRuntime::new();
        mutate(&runtime.updates, |state| {
            state.status = RunPhase::Completed;
            state.model = Some("prior-model".into());
            state.thinking_effort = Some("high".into());
            state.usage = Some(UsageSnapshot {
                context_tokens: Some(200),
                session_tokens: 100,
                input_tokens: 80,
                cached_input_tokens: 0,
                output_tokens: 20,
                reasoning_output_tokens: None,
                model_context_window: Some(8_000),
            });
        });
        runtime.new_session().await.unwrap();
        let reset = runtime.snapshot();
        assert_eq!(reset.status, RunPhase::Idle);
        assert!(reset.model.is_none());
        assert!(reset.thinking_effort.is_none());
        assert!(reset.usage.is_none());
    }

    #[tokio::test]
    async fn new_session_rotates_snapshot_conversation_id_and_keeps_the_old_record() {
        let root = std::env::temp_dir().join(format!(
            "otto-rotate-history-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = AgentRuntime::persistent_with_history(
            root.join("marker"),
            root.join("conversations.json"),
        );
        runtime.persist_prompt(9, "Previous chat").unwrap();
        let previous = runtime.snapshot().conversation_id;

        runtime
            .new_session()
            .await
            .expect("no active run blocks rotation");

        let snapshot = runtime.snapshot();
        assert_ne!(snapshot.conversation_id, previous);
        assert!(!snapshot.conversation_id.is_empty());
        assert_eq!(snapshot.messages.len(), 0);
        let list = runtime.conversation.history.list().unwrap();
        assert!(list.iter().any(|summary| summary.id == previous));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn persistent_history_stores_chat_text_without_runtime_identifiers() {
        let root = std::env::temp_dir().join(format!(
            "otto-runtime-history-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let history_path = root.join("conversations.json");
        let runtime =
            AgentRuntime::persistent_with_history(root.join("marker"), history_path.clone());
        runtime.persist_prompt(1, "Explain ownership").unwrap();
        let id = runtime.conversation.id.lock().unwrap().clone();
        let record = runtime.conversation.history.open(&id).unwrap();
        assert_eq!(record.messages[0].text, "Explain ownership");
        let raw = std::fs::read_to_string(history_path).unwrap();
        assert!(!raw.contains("cwd"));
        assert!(!raw.contains("threadId"));
        let _ = std::fs::remove_dir_all(root);
    }

    fn terminal_snapshot(status: RunPhase) -> Snapshot {
        Snapshot {
            run_id: 3,
            seq: 9,
            status,
            provider: ProviderId::Codex,
            cwd: String::new(),
            conversation_id: "kept".into(),
            thread_id: None,
            model: None,
            thinking_effort: None,
            usage: None,
            messages: vec![ChatMessage {
                id: "3:user".into(),
                role: "user".into(),
                text: "Explain ownership".into(),
            }],
            capture: CaptureSnapshot::default(),
            error: None,
        }
    }

    #[test]
    fn terminal_history_write_failure_keeps_marker_and_reports_a_notice() {
        let root = std::env::temp_dir().join(format!(
            "otto-terminal-failure-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let blocker = root.join("blocker");
        fs::write(&blocker, b"not a directory").unwrap();
        let runtime = AgentRuntime::persistent_with_history(
            root.join("marker"),
            blocker.join("conversations.json"),
        );
        runtime.recovery.as_ref().unwrap().mark(3).unwrap();
        mutate(&runtime.updates, |state| state.run_id = 3);

        persist_terminal_outcome(
            &runtime.conversation,
            runtime.recovery.as_ref().unwrap(),
            &runtime.updates,
            &Snapshot {
                conversation_id: runtime.snapshot().conversation_id,
                ..terminal_snapshot(RunPhase::Failed)
            },
        );

        let observed = runtime.updates.borrow().clone();
        assert!(
            observed
                .error
                .as_deref()
                .unwrap()
                .contains("Conversation history could not be saved")
        );
        assert_eq!(
            fs::read_to_string(root.join("marker")).unwrap(),
            "3",
            "marker must survive so restart reports interrupted instead of a fabricated completion"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn terminal_history_write_success_clears_marker_without_false_completion_notice() {
        let root = std::env::temp_dir().join(format!(
            "otto-terminal-success-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = AgentRuntime::persistent_with_history(
            root.join("marker"),
            root.join("conversations.json"),
        );
        runtime.recovery.as_ref().unwrap().mark(3).unwrap();
        mutate(&runtime.updates, |state| state.run_id = 3);

        persist_terminal_outcome(
            &runtime.conversation,
            runtime.recovery.as_ref().unwrap(),
            &runtime.updates,
            &Snapshot {
                conversation_id: runtime.snapshot().conversation_id,
                ..terminal_snapshot(RunPhase::Failed)
            },
        );

        assert!(runtime.snapshot().error.is_none());
        assert!(!root.join("marker").exists());
        let id = runtime.conversation.id.lock().unwrap().clone();
        assert_eq!(
            runtime.conversation.history.open(&id).unwrap().messages[0].text,
            "Explain ownership"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn contextual_prompt_reconstructs_local_transcript_for_a_new_provider() {
        let prompt = contextual_prompt(
            &[
                ChatMessage {
                    id: "1:user".into(),
                    role: "user".into(),
                    text: "What is ownership?".into(),
                },
                ChatMessage {
                    id: "1:assistant".into(),
                    role: "assistant".into(),
                    text: "Ownership controls cleanup.".into(),
                },
            ],
            "How does borrowing relate?",
        );
        assert!(prompt.contains("User: What is ownership?"));
        assert!(prompt.contains("Otto: Ownership controls cleanup."));
        assert!(prompt.ends_with("New user question:\nHow does borrowing relate?"));
    }

    #[test]
    fn reconstructed_context_keeps_newest_messages_within_byte_budget() {
        let messages = vec![
            ChatMessage {
                id: "1:user".into(),
                role: "user".into(),
                text: "ancient".repeat(10_000),
            },
            ChatMessage {
                id: "2:user".into(),
                role: "user".into(),
                text: "Latest question".into(),
            },
            ChatMessage {
                id: "2:assistant".into(),
                role: "assistant".into(),
                text: "Latest answer".into(),
            },
        ];

        let prompt = contextual_prompt(&messages, "Follow-up");
        assert!(prompt.contains("User: Latest question"));
        assert!(prompt.contains("Otto: Latest answer"));
        assert!(!prompt.contains("ancient"));
        assert!(prompt.find("Latest question").unwrap() < prompt.find("Latest answer").unwrap());
        assert!(prompt.len() <= 48_000);
        assert!(prompt.ends_with("New user question:\nFollow-up"));
    }

    #[tokio::test]
    async fn opening_history_restores_transcript_without_provider_thread_identity() {
        let root = std::env::temp_dir().join(format!(
            "otto-history-open-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = AgentRuntime::persistent_with_history(
            root.join("marker"),
            root.join("conversations.json"),
        );
        runtime
            .conversation
            .history
            .upsert(history::ConversationRecord {
                id: "saved".into(),
                title: "Saved chat".into(),
                provider: ProviderId::Codex,
                model: Some("model".into()),
                thinking_effort: Some("high".into()),
                messages: vec![
                    ChatMessage {
                        id: "1:user".into(),
                        role: "user".into(),
                        text: "Explain ownership".into(),
                    },
                    ChatMessage {
                        id: "1:assistant".into(),
                        role: "assistant".into(),
                        text: "Ownership manages resource lifetime.".into(),
                    },
                ],
                created_at: 1,
                updated_at: 2,
                interrupted: false,
            })
            .unwrap();
        mutate(&runtime.updates, |state| {
            state.usage = Some(UsageSnapshot {
                context_tokens: None,
                session_tokens: 50,
                input_tokens: 25,
                cached_input_tokens: 0,
                output_tokens: 25,
                reasoning_output_tokens: None,
                model_context_window: None,
            });
        });
        let snapshot = runtime.history_open("saved").await.unwrap();
        assert_eq!(snapshot.status, RunPhase::Completed);
        assert!(snapshot.usage.is_none());
        assert_eq!(snapshot.model.as_deref(), Some("model"));
        assert_eq!(snapshot.thinking_effort.as_deref(), Some("high"));
        assert_eq!(snapshot.messages.len(), 2);
        assert!(snapshot.thread_id.is_none());
        assert_eq!(snapshot.provider, ProviderId::Codex);
        assert_eq!(runtime.conversation.id.lock().unwrap().as_str(), "saved");
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn live_sender_followup_keeps_provider_thread_identity() {
        let runtime = AgentRuntime::new();
        let cwd = std::fs::canonicalize(default_workspace_path()).unwrap();
        let (sender, _receiver) = mpsc::channel(4);
        *runtime.control.lock().await = Some(sender);
        mutate(&runtime.updates, |state| {
            state.status = "completed".into();
            state.thread_id = Some("provider-session".into());
            state.cwd = cwd.to_string_lossy().into_owned();
        });
        let _outcome = runtime
            .ask(
                "continue the explanation".into(),
                "codex".into(),
                None,
                None,
            )
            .await;
        assert!(
            runtime.snapshot().thread_id.is_some(),
            "a follow-up over a live provider transport must keep its session identity"
        );
    }

    #[test]
    fn long_transcripts_persist_the_newest_bounded_window() {
        let runtime = AgentRuntime::new();
        mutate(&runtime.updates, |state| {
            for index in 0..30 {
                state.messages.push(ChatMessage {
                    id: format!(
                        "{index}:{}",
                        if index % 2 == 0 { "user" } else { "assistant" }
                    ),
                    role: (if index % 2 == 0 { "user" } else { "assistant" }).into(),
                    text: format!("message {index}"),
                });
            }
        });
        let record = history::record_from_snapshot("long-conversation", &runtime.snapshot(), false)
            .expect("a long transcript must produce a record");
        assert_eq!(record.messages.len(), 24);
        assert_eq!(record.messages.first().unwrap().text, "message 6");
        runtime
            .conversation
            .history
            .upsert(record)
            .expect("a bounded record must persist");
    }

    #[tokio::test]
    async fn active_history_deletion_resets_without_resurrecting() {
        let root = std::env::temp_dir().join(format!(
            "otto-delete-active-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = AgentRuntime::persistent_with_history(
            root.join("marker"),
            root.join("conversations.json"),
        );
        runtime.persist_prompt(7, "Original chat").unwrap();
        let deleted = runtime.snapshot().conversation_id;
        assert!(runtime.conversation.history.open(&deleted).is_ok());

        runtime.history_delete(&deleted).await.unwrap();

        let after = runtime.snapshot();
        assert_ne!(after.conversation_id, deleted);
        assert_eq!(after.conversation_id, *runtime.conversation.id.lock().unwrap());
        assert_eq!(after.status, RunPhase::Idle);
        assert!(after.messages.is_empty());
        assert!(after.thread_id.is_none());
        assert!(runtime.conversation.history.open(&deleted).is_err());

        runtime.persist_prompt(8, "Fresh chat").unwrap();
        assert!(runtime.conversation.history.open(&deleted).is_err());
        let items = runtime.conversation.history.list().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, after.conversation_id);
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn active_history_deletion_rejects_running_turn() {
        let root = std::env::temp_dir().join(format!(
            "otto-delete-running-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = AgentRuntime::persistent_with_history(
            root.join("marker"),
            root.join("conversations.json"),
        );
        runtime.persist_prompt(7, "Still running").unwrap();
        let id = runtime.snapshot().conversation_id;
        mutate(&runtime.updates, |state| {
            state.run_id = 7;
            state.status = RunPhase::Streaming;
        });
        assert!(runtime.history_delete(&id).await.is_err());
        assert_eq!(runtime.snapshot().conversation_id, id);
        assert_eq!(
            runtime.conversation.history.open(&id).unwrap().messages[0].text,
            "Still running"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn terminal_observer_refuses_different_conversation_with_same_run_id() {
        let root = std::env::temp_dir().join(format!(
            "otto-stale-conversation-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = AgentRuntime::persistent_with_history(
            root.join("marker"),
            root.join("conversations.json"),
        );
        runtime.recovery.as_ref().unwrap().mark(3).unwrap();
        mutate(&runtime.updates, |state| state.run_id = 3);
        let stale = terminal_snapshot(RunPhase::Completed);

        persist_terminal_outcome(
            &runtime.conversation,
            runtime.recovery.as_ref().unwrap(),
            &runtime.updates,
            &stale,
        );
        assert!(runtime.conversation.history.list().unwrap().is_empty());
        assert_eq!(fs::read_to_string(root.join("marker")).unwrap(), "3");
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn failed_recovery_marker_does_not_reserve_readiness() {
        let parent = std::env::temp_dir().join(format!(
            "otto-recovery-runtime-file-parent-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(&parent, b"not a directory").unwrap();
        let runtime = AgentRuntime::persistent(parent.join("marker"));

        assert!(
            runtime
                .ask("explain this".into(), "codex".into(), None, None,)
                .await
                .is_err()
        );
        assert_eq!(runtime.snapshot().status, "idle");
        assert!(runtime.active_run_readiness.lock().unwrap().is_none());
        std::fs::remove_file(parent).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn selected_pi_runtime_is_independent_of_previous_answer() {
        let runtime = AgentRuntime::new();
        mutate(&runtime.updates, |state| {
            state.provider = "pi".into();
            state.model = Some("netra/text-only".into());
            state.thinking_effort = Some("off".into());
        });
        *runtime.selected_runtime.lock().unwrap() = ModelSelection {
            model: Some("opencode-go/vision".into()),
            thinking_effort: Some("high".into()),
        };
        let state = runtime.snapshot();
        let chosen = runtime.capture_runtime_options(&state);
        assert_eq!(chosen.model.as_deref(), Some("opencode-go/vision"));
        assert_eq!(chosen.thinking_effort.as_deref(), Some("high"));
        assert_eq!(state.model.as_deref(), Some("netra/text-only"));
    }

    #[tokio::test]
    async fn switching_provider_clears_pi_capture_selection() {
        let runtime = AgentRuntime::new();
        mutate(&runtime.updates, |state| {
            state.provider = "pi".into();
        });
        *runtime.selected_runtime.lock().unwrap() = ModelSelection {
            model: Some("opencode-go/vision".into()),
            thinking_effort: Some("high".into()),
        };
        runtime.select_provider("codex".into()).await.unwrap();
        assert!(runtime.selected_runtime.lock().unwrap().model.is_none());
    }

    #[tokio::test]
    async fn new_session_clears_pi_capture_selection() {
        let runtime = AgentRuntime::new();
        *runtime.selected_runtime.lock().unwrap() = ModelSelection {
            model: Some("opencode-go/vision".into()),
            thinking_effort: None,
        };
        runtime.new_session().await.unwrap();
        assert!(runtime.selected_runtime.lock().unwrap().model.is_none());
    }

    #[test]
    fn model_selection_rejects_capture_conversation_and_superseded_requests() {
        let runtime = AgentRuntime::new();
        let mut previous = runtime.snapshot();
        previous.provider = ProviderId::Pi;
        previous.capture.phase = "idle".into();
        let mut current = previous.clone();
        current.capture.request_id = previous.capture.request_id + 1;
        current.capture.phase = "preparing".into();
        assert!(!runtime_selection_still_current(&previous, &current, 1, 1));
        current.capture.phase = "idle".into();
        assert!(!runtime_selection_still_current(&previous, &current, 1, 1));
        assert!(runtime_selection_still_current(&previous, &previous, 1, 1));
        let mut reopened = previous.clone();
        reopened.conversation_id = "another-conversation".into();
        assert!(!runtime_selection_still_current(&previous, &reopened, 1, 1));
        assert!(!runtime_selection_still_current(&previous, &previous, 1, 2));
    }

    #[tokio::test]
    async fn cannot_change_pi_runtime_while_running() {
        let runtime = AgentRuntime::new();
        mutate(&runtime.updates, |state| {
            state.provider = "pi".into();
            state.status = "streaming".into();
        });
        assert!(
            runtime
                .select_runtime_options(Some("pi/model".into()), None)
                .await
                .is_err()
        );
        assert!(runtime.selected_runtime.lock().unwrap().model.is_none());
    }

    #[test]
    fn duplicate_hotkey_never_overwrites_an_active_capture_status() {
        let runtime = AgentRuntime::new();
        runtime.capture_error("Screen capture is already in progress.");
        assert_eq!(runtime.snapshot().status, "idle");
        assert!(runtime.snapshot().error.is_none());
    }

    #[cfg(windows)]
    #[test]
    fn capture_begin_exposes_preparing_and_rejects_overlap() {
        let runtime = AgentRuntime::new();
        let (request_id, reservation) = runtime.begin_capture().expect("capture starts");
        let snapshot = runtime.snapshot();
        assert_eq!(snapshot.capture.request_id, request_id);
        assert_eq!(snapshot.capture.phase, "preparing");
        assert!(runtime.begin_capture().is_err());
        drop(reservation);
        assert!(runtime.begin_capture().is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn capture_failure_is_visible_and_clearable() {
        let runtime = AgentRuntime::new();
        let (_, reservation) = runtime.begin_capture().expect("capture starts");
        drop(reservation);
        runtime.capture_error("Target unavailable.");
        let snapshot = runtime.snapshot();
        assert_eq!(snapshot.capture.phase, "failed");
        assert_eq!(
            snapshot.capture.error.as_deref(),
            Some("Target unavailable.")
        );
        runtime.clear_capture_error();
        assert_eq!(runtime.snapshot().capture.phase, "idle");
    }

    #[cfg(windows)]
    #[test]
    fn stale_capture_failure_does_not_replace_new_request() {
        let runtime = AgentRuntime::new();
        let (old_request_id, old_reservation) = runtime.begin_capture().expect("capture starts");
        drop(old_reservation);
        let (new_request_id, new_reservation) = runtime.begin_capture().expect("capture retries");
        runtime.capture_error_for(old_request_id, "Old capture failed.");
        let snapshot = runtime.snapshot();
        assert_eq!(snapshot.capture.request_id, new_request_id);
        assert_eq!(snapshot.capture.phase, "preparing");
        assert_ne!(snapshot.capture.request_id, old_request_id);
        drop(new_reservation);
    }

    #[cfg(windows)]
    #[test]
    fn capture_configuration_errors_never_change_terminal_agent_outcome() {
        let runtime = AgentRuntime::new();
        mutate(&runtime.updates, |s| {
            s.run_id = 5;
            s.thread_id = Some("thread".into());
            s.status = "completed".into();
        });
        runtime.capture_error("Shortcut unavailable.");
        assert_eq!(runtime.snapshot().status, "completed");
        assert!(
            runtime
                .snapshot()
                .error
                .as_deref()
                .unwrap()
                .starts_with("Capture: ")
        );
        runtime.clear_capture_error();
        assert_eq!(runtime.snapshot().status, "completed");
        assert!(runtime.snapshot().error.is_none());

        mutate(&runtime.updates, |s| {
            s.run_id = 6;
            s.status = "failed".into();
            s.error = Some("Provider failed without an answer.".into());
        });
        runtime.capture_error("No available target.");
        assert_eq!(runtime.snapshot().status, "failed");
        assert_eq!(
            runtime.snapshot().error.as_deref(),
            Some("Provider failed without an answer.")
        );
        runtime.clear_capture_error();
        assert_eq!(runtime.snapshot().status, "failed");
        assert_eq!(
            runtime.snapshot().error.as_deref(),
            Some("Provider failed without an answer.")
        );

        mutate(&runtime.updates, |s| {
            s.status = "idle".into();
            s.thread_id = None;
            s.error = None;
        });
        runtime.capture_error("No available target.");
        assert_eq!(runtime.snapshot().status, "idle");
        assert!(
            runtime
                .snapshot()
                .error
                .as_deref()
                .unwrap()
                .starts_with("Capture: ")
        );
        runtime.clear_capture_error();
        assert_eq!(runtime.snapshot().status, "idle");
        assert!(runtime.snapshot().error.is_none());
    }

    #[cfg(windows)]
    #[test]
    fn capture_reservation_rejects_overlap_and_releases_on_drop() {
        let in_flight = Arc::new(AtomicBool::new(false));
        let first =
            CaptureReservation::acquire(Arc::clone(&in_flight)).expect("first trigger accepted");
        assert!(CaptureReservation::acquire(Arc::clone(&in_flight)).is_err());
        drop(first);
        let again = CaptureReservation::acquire(Arc::clone(&in_flight)).expect("retry accepted");
        drop(again);
        assert!(!in_flight.load(Ordering::Acquire));
    }

    #[test]
    fn old_run_cannot_replace_new_terminal_state() {
        let (tx, _) = watch::channel(Snapshot {
            run_id: 2,
            seq: 4,
            status: "completed".into(),
            provider: "codex".into(),
            conversation_id: String::new(),
            cwd: String::new(),
            thread_id: None,
            model: None,
            thinking_effort: None,
            usage: None,
            messages: vec![],
            capture: CaptureSnapshot::default(),
            error: None,
        });
        events::ProviderEvents::new(tx.clone()).fail(1, "late failure");
        assert_eq!(tx.borrow().status, "completed");
        assert_eq!(tx.borrow().error, None);
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn agy_text_only_headless_input_blocks_capture_before_first_chat() {
        let runtime = AgentRuntime::new();
        runtime
            .select_provider("agy".into())
            .await
            .expect("Agy selection");
        assert_eq!(runtime.snapshot().provider, "agy");
        let (request_id, reservation) = runtime.begin_capture().expect("capture starts");
        let capture = runtime
            .capture_hotkey(
                request_id,
                reservation,
                || -> Result<CapturedImage, String> {
                    panic!("The capture closure must never execute for unsupported Agy images");
                },
            )
            .await;
        assert_eq!(
            capture.unwrap_err(),
            "Agy headless streaming accepts text only. Select Codex or Pi."
        );
        assert!(runtime.snapshot().messages.is_empty());
    }

    #[tokio::test]
    async fn provider_cannot_change_while_session_is_owned() {
        let runtime = AgentRuntime::new();
        assert!(runtime.select_provider("opencode".into()).await.is_err());
        runtime
            .select_provider("agy".into())
            .await
            .expect("Agy should be selectable before the session");
        let (tx, _rx) = mpsc::channel(1);
        *runtime.control.lock().await = Some(tx);
        assert!(runtime
            .select_provider_with_timeout("pi".into(), Duration::from_millis(10))
            .await
            .is_err());
        assert_eq!(runtime.snapshot().provider, "agy");
    }

    #[tokio::test]
    async fn stopping_is_visible_before_control_can_be_consumed() {
        let runtime = AgentRuntime::new();
        let (tx, mut rx) = mpsc::channel(1);
        *runtime.control.lock().await = Some(tx);
        mutate(&runtime.updates, |snapshot| {
            snapshot.status = "streaming".into()
        });
        runtime.stop().await.expect("Stop must be accepted");
        assert_eq!(runtime.snapshot().status, "stopping");
        assert!(matches!(rx.try_recv(), Ok(Control::Stop)));
    }

    #[tokio::test]
    async fn stop_is_idempotent_after_the_first_stop_request() {
        let runtime = AgentRuntime::new();
        let (tx, mut rx) = mpsc::channel(2);
        *runtime.control.lock().await = Some(tx);
        mutate(&runtime.updates, |snapshot| {
            snapshot.status = "streaming".into()
        });

        runtime.stop().await.expect("first Stop must be accepted");
        runtime
            .stop()
            .await
            .expect("repeated Stop must be harmless");

        assert_eq!(runtime.snapshot().status, "stopping");
        assert!(matches!(rx.try_recv(), Ok(Control::Stop)));
        assert!(rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn stop_cancels_readiness_without_an_owned_process() {
        let runtime = AgentRuntime::new();
        let cancelled = runtime.begin_run_readiness().unwrap();
        mutate(&runtime.updates, |snapshot| {
            snapshot.run_id = 41;
            snapshot.status = "starting".into();
        });

        let cancellation = tokio::spawn(async move { cancelled.await.is_ok() });
        tokio::time::timeout(Duration::from_millis(100), runtime.stop())
            .await
            .expect("Stop must not wait for readiness")
            .expect("Stop must accept readiness cancellation");
        assert_eq!(runtime.snapshot().status, "stopped");
        assert!(cancellation.await.unwrap());
    }

    #[tokio::test]
    async fn new_session_closes_provider_before_clearing_conversation() {
        let runtime = AgentRuntime::new();
        let (sender, mut receiver) = mpsc::channel(2);
        *runtime.control.lock().await = Some(sender);
        mutate(&runtime.updates, |s| {
            s.run_id = 8;
            s.status = "completed".into();
            s.thread_id = Some("thread-1".into());
            s.messages.push(ChatMessage {
                id: "8:user".into(),
                role: "user".into(),
                text: "hello".into(),
            });
        });

        let (close_seen, observed) = oneshot::channel();
        let (may_finish, proceed) = oneshot::channel();
        let worker = tokio::spawn(async move {
            let Some(Control::Close { claimed, finished }) = receiver.recv().await else {
                panic!("new session must close the existing process");
            };
            assert!(!claimed.swap(true, Ordering::SeqCst));
            close_seen.send(()).unwrap();
            proceed.await.unwrap();
            finished.send(()).unwrap();
        });

        let reset = runtime.new_session();
        tokio::pin!(reset);
        tokio::select! {
            _ = &mut reset => panic!("reset must wait until Codex closes"),
            _ = observed => {
                assert_eq!(runtime.snapshot().status, "completed");
                assert!(runtime.snapshot().thread_id.is_some());
            }
        }
        may_finish.send(()).unwrap();
        reset.await.expect("new session");
        worker.await.unwrap();
        let snapshot = runtime.snapshot();
        assert_eq!(snapshot.status, "idle");
        assert!(snapshot.thread_id.is_none());
        assert!(snapshot.messages.is_empty());
        assert!(runtime.control.lock().await.is_none());
        assert!(snapshot.run_id > 8);
    }

    #[tokio::test]
    async fn claimed_close_without_ack_has_a_bounded_deadline_and_preserves_session() {
        let runtime = AgentRuntime::new();
        let (sender, mut receiver) = mpsc::channel(2);
        *runtime.control.lock().await = Some(sender);
        mutate(&runtime.updates, |s| {
            s.run_id = 8;
            s.status = "completed".into();
            s.thread_id = Some("thread-8".into());
        });
        let (seen, observed) = oneshot::channel();
        let (release, proceed) = oneshot::channel::<()>();
        let worker = tokio::spawn(async move {
            let Some(Control::Close { claimed, finished }) = receiver.recv().await else {
                panic!("close required");
            };
            assert!(!claimed.swap(true, Ordering::SeqCst));
            seen.send(()).unwrap();
            proceed.await.unwrap();
            finished.send(()).ok();
        });

        let closing = runtime.new_session_with_timeout(Duration::from_millis(250));
        tokio::pin!(closing);
        tokio::select! {
            _ = &mut closing => panic!("close must not reset before the worker acknowledges"),
            result = observed => assert!(result.is_ok()),
        }
        let result = timeout(Duration::from_secs(1), &mut closing)
            .await
            .expect("close timeout must be bounded");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("still closing"));
        assert_eq!(runtime.snapshot().status, "completed");
        assert_eq!(runtime.snapshot().thread_id.as_deref(), Some("thread-8"));
        release.send(()).unwrap();
        worker.await.unwrap();
        runtime
            .new_session_with_timeout(Duration::from_secs(1))
            .await
            .expect("retry after closure");
        assert_eq!(runtime.snapshot().status, "idle");
    }

    #[test]
    fn timed_out_close_is_not_executed_late() {
        let claimed = AtomicBool::new(false);

        assert!(!claimed.swap(true, Ordering::SeqCst));

        assert!(claimed.swap(true, Ordering::SeqCst));
    }

    #[tokio::test]
    async fn new_session_does_not_reset_an_active_capture() {
        let runtime = AgentRuntime::new();
        let initial = runtime.snapshot();
        mutate(&runtime.updates, |state| {
            state.capture.request_id = 3;
            state.capture.phase = "preparing".into();
        });
        assert!(runtime.new_session().await.is_err());
        let current = runtime.snapshot();
        assert_eq!(current.conversation_id, initial.conversation_id);
        assert_eq!(current.run_id, initial.run_id);
        assert_eq!(current.capture.request_id, 3);
        assert_eq!(current.capture.phase, "preparing");
        assert_eq!(*runtime.conversation.id.lock().unwrap(), initial.conversation_id);

        mutate(&runtime.updates, |state| state.capture.phase = "failed".into());
        runtime.new_session().await.unwrap();
        assert_ne!(runtime.snapshot().conversation_id, initial.conversation_id);
    }

    #[tokio::test]
    async fn new_session_cannot_discard_running_request() {
        let runtime = AgentRuntime::new();
        for status in ["starting", "streaming", "stopping"] {
            mutate(&runtime.updates, |s| s.status = status.into());
            assert!(runtime.new_session().await.is_err(), "{status}");
            assert_eq!(runtime.snapshot().status, status);
        }
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn timed_out_capture_keeps_native_work_reserved_until_it_finishes() {
        let in_flight = Arc::new(AtomicBool::new(false));
        let reservation = Arc::new(CaptureReservation::acquire(Arc::clone(&in_flight)).unwrap());
        let (started_tx, started_rx) = oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
        let attempt = tokio::spawn({
            let reservation = Arc::clone(&reservation);
            async move {
                capture_with_deadline(&reservation, Duration::from_millis(40), move || {
                    let _ = started_tx.send(());
                    let _ = release_rx.recv();
                    Err("simulated blocked capture".into())
                })
                .await
            }
        });
        started_rx.await.expect("worker entered blocking operation");
        drop(reservation);
        let outcome = attempt.await.expect("timeout task completed");
        match outcome {
            Err(message) => assert!(message.contains("timed out")),
            Ok(_) => panic!("blocked capture must time out"),
        }
        assert!(CaptureReservation::acquire(Arc::clone(&in_flight)).is_err());
        release_tx.send(()).unwrap();
        timeout(Duration::from_secs(2), async {
            while in_flight.load(Ordering::SeqCst) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("native worker eventually released capture reservation");
        assert!(CaptureReservation::acquire(in_flight).is_ok());
    }

    #[test]
    fn default_workspace_uses_home_root_and_expands_tilde_children() {
        let home = default_workspace_path();
        assert_eq!(resolve_workspace_path("~"), home);
        assert_eq!(resolve_workspace_path(""), home);
        assert_eq!(resolve_workspace_path("~/otto"), home.join("otto"));
    }
}
