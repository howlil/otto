mod events;
mod policy;
mod providers;
mod readiness_probe;
mod recovery;
pub mod session;

use policy::InteractionMode;
use providers::registry::ProviderId;
use serde::Serialize;
use session::{ApprovalDecision, PendingApproval};
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

#[derive(Clone, Serialize)]
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
    pub agent_session: bool,
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
            agent_session: false,
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
    pub status: String,
    pub mode: String,
    pub provider: String,
    pub cwd: String,
    pub thread_id: Option<String>,
    pub model: Option<String>,
    pub thinking_effort: Option<String>,
    pub usage: Option<UsageSnapshot>,
    pub messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activity: Option<session::ToolActivity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval: Option<PendingApproval>,
    pub capture: CaptureSnapshot,
    pub error: Option<String>,
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
    Decide {
        approval_id: String,
        decision: ApprovalDecision,
    },
}

pub struct AgentRuntime {
    updates: watch::Sender<Snapshot>,
    control: Mutex<Option<mpsc::Sender<Control>>>,
    selected_runtime: StdMutex<ModelSelection>,
    workspace_editing: AtomicBool,
    readiness_probes: StdMutex<readiness_probe::ReadinessProbeState>,
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
        Self::with_recovery(None)
    }

    pub fn persistent(path: PathBuf) -> Self {
        Self::with_recovery(Some(recovery::RecoveryMarker::new(path)))
    }

    fn with_recovery(recovery: Option<recovery::RecoveryMarker>) -> Self {
        let interrupted = recovery
            .as_ref()
            .is_some_and(recovery::RecoveryMarker::take_interrupted);
        let cwd = default_workspace_path().to_string_lossy().into_owned();
        let (updates, _) = watch::channel(Snapshot {
            run_id: 0,
            seq: u64::from(interrupted),
            status: if interrupted { "failed" } else { "idle" }.into(),
            mode: InteractionMode::QuickAsk.as_str().into(),
            provider: "codex".into(),
            cwd,
            thread_id: None,
            model: None,
            thinking_effort: None,
            usage: None,
            messages: Vec::new(),
            activity: None,
            approval: None,
            capture: CaptureSnapshot::default(),
            error: interrupted.then(|| {
                "Previous agent request may have been interrupted. No answer was restored. Ask again to start a new session.".into()
            }),
        });
        Self {
            updates,
            control: Mutex::new(None),
            selected_runtime: StdMutex::new(ModelSelection::default()),
            workspace_editing: AtomicBool::new(false),
            readiness_probes: StdMutex::new(readiness_probe::ReadinessProbeState::default()),
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
        let mut receiver = self.updates.subscribe();
        tauri::async_runtime::spawn(async move {
            while receiver.changed().await.is_ok() {
                let snapshot = receiver.borrow_and_update().clone();
                if matches!(snapshot.status.as_str(), "completed" | "failed" | "stopped") {
                    marker.clear_if(snapshot.run_id);
                }
            }
        });
    }

    pub fn snapshot(&self) -> Snapshot {
        self.updates.borrow().clone()
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

    pub fn codex_installed(&self) -> bool {
        providers::codex::executable().is_some()
    }

    pub async fn select_provider(&self, provider: String) -> Result<(), String> {
        ProviderId::parse(&provider).ok_or("Unknown provider.")?;
        let guard = self.control.lock().await;
        let current = self.snapshot();
        if matches!(
            current.status.as_str(),
            "starting" | "streaming" | "stopping" | "approvalRequired"
        ) || current.thread_id.is_some()
            || guard.as_ref().is_some_and(|sender| !sender.is_closed())
        {
            return Err("Start a new session before changing the provider.".into());
        }
        if current.provider != provider {
            *self.selected_runtime.lock().unwrap() = ModelSelection::default();
            self.workspace_editing.store(false, Ordering::SeqCst);
            mutate(&self.updates, |state| {
                state.provider = provider;
                state.error = None;
            });
        }
        Ok(())
    }

    pub fn begin_workspace_edit(&self) -> Result<(), String> {
        let state = self.snapshot();
        if matches!(
            state.status.as_str(),
            "starting" | "streaming" | "stopping" | "approvalRequired"
        ) || state.thread_id.is_some() || state.capture.phase != "idle"
        {
            return Err("Finish the current session before editing the project.".into());
        }
        self.workspace_editing.store(true, Ordering::SeqCst);
        Ok(())
    }

    pub async fn commit_workspace(&self, directory: String) -> Result<String, String> {
        let guard = self.control.lock().await;
        let state = self.snapshot();
        if matches!(
            state.status.as_str(),
            "starting" | "streaming" | "stopping" | "approvalRequired"
        ) || state.thread_id.is_some()
            || state.capture.phase != "idle"
            || guard.as_ref().is_some_and(|sender| !sender.is_closed())
        {
            return Err("Start a new session before changing the project.".into());
        }
        if directory.trim().is_empty() {
            return Err("Enter an existing project folder.".into());
        }
        let cwd = std::fs::canonicalize(resolve_workspace_path(&directory))
            .map_err(|_| "Working project folder does not exist.".to_string())?;
        if !cwd.is_dir() {
            return Err("Working project must be a folder.".into());
        }
        let confirmed = cwd.to_string_lossy().into_owned();
        mutate(&self.updates, |state| state.cwd = confirmed.clone());
        self.workspace_editing.store(false, Ordering::SeqCst);
        Ok(confirmed)
    }

    pub fn cancel_workspace_edit(&self) {
        self.workspace_editing.store(false, Ordering::SeqCst);
    }

    pub async fn select_runtime_options(
        &self,
        model: Option<String>,
        thinking_effort: Option<String>,
    ) -> Result<(), String> {
        let _guard = self.control.lock().await;
        let current = self.snapshot();
        if current.provider != "pi" {
            return Err("Pi runtime selection requires the Pi provider.".into());
        }
        if matches!(
            current.status.as_str(),
            "starting" | "streaming" | "stopping" | "approvalRequired"
        ) || current.capture.phase != "idle"
        {
            return Err("Finish the current request or capture before changing the Pi model.".into());
        }
        let readiness = self
            .provider_readiness_for(&current.provider, Some(&current.cwd), model.as_deref())
            .await;
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
        if state.provider == "pi" {
            self.selected_runtime.lock().unwrap().clone()
        } else {
            ModelSelection {
                model: state.model.clone(),
                thinking_effort: state.thinking_effort.clone(),
            }
        }
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

    pub async fn codex_readiness(&self, requested_cwd: Option<&str>) -> ProviderReadiness {
        self.provider_readiness(ProviderId::Codex.as_str(), requested_cwd)
            .await
    }

    #[cfg(windows)]
    pub(crate) fn begin_capture(&self) -> Result<(u64, CaptureReservation), String> {
        if self.workspace_editing.load(Ordering::SeqCst) {
            return Err("Confirm the working project folder before capturing.".into());
        }
        if matches!(
            self.snapshot().status.as_str(),
            "starting" | "streaming" | "stopping" | "approvalRequired"
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
        if self.workspace_editing.load(Ordering::SeqCst) {
            return Err("Confirm the working project folder before capturing.".into());
        }
        if state.capture.request_id != request_id || state.capture.phase != "preparing" {
            return Err("Capture request is no longer current.".into());
        }
        if matches!(
            state.status.as_str(),
            "starting" | "streaming" | "stopping" | "approvalRequired"
        ) {
            return Err("Finish or Stop the current answer before capturing.".into());
        }
        if !ProviderId::parse(&state.provider).is_some_and(ProviderId::image_transport) {
            return Err("Agy headless streaming accepts text only. Select Codex or Pi.".into());
        }
        if state.thread_id.is_some() && state.mode != "quickAsk" {
            return Err("Start a new Quick Ask session before using screen capture.".into());
        }
        let selected = self.capture_runtime_options(&state);
        let ready = self
            .provider_readiness_for(&state.provider, Some(&state.cwd), selected.model.as_deref())
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
            "quickAsk".into(),
            state.provider,
            selected,
            Some(image),
        ).await
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
                s.status.as_str(),
                "starting" | "streaming" | "stopping" | "approvalRequired"
            ) && (s.status != "failed"
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
        cwd: String,
        mode: String,
        provider: String,
        model: Option<String>,
        thinking_effort: Option<String>,
    ) -> Result<(), String> {
        self.ask_with_capture(
            text,
            cwd,
            mode,
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
        mode: String,
        provider: String,
        selection: ModelSelection,
        capture: Option<CapturedImage>,
    ) -> Result<(), String> {
        let ModelSelection {
            model,
            thinking_effort,
        } = selection;
        let text = text.trim().to_owned();
        if text.is_empty() || text.len() > 12_000 {
            return Err("Enter a question (up to 12,000 bytes).".into());
        }
        let mode = InteractionMode::parse(&mode)?;
        let selected = ProviderId::parse(&provider).ok_or("Selected provider is unavailable.")?;
        selected.validate(mode, capture.is_some())?;
        let capture_origin = capture.is_some();
        let cwd = std::fs::canonicalize(resolve_workspace_path(&cwd))
            .map_err(|_| "Working folder does not exist.".to_string())?;
        if !cwd.is_dir() {
            return Err("Working context must be a folder.".into());
        }
        let mut guard = self.control.lock().await;
        let current = self.snapshot();
        if matches!(
            current.status.as_str(),
            "starting" | "streaming" | "stopping" | "approvalRequired"
        ) {
            return Err("An answer is already running.".into());
        }
        if current.provider != provider {
            return Err(
                "Select the provider in Agent Settings before requesting an answer.".into(),
            );
        }

        let reused_agy = guard.as_ref().is_some_and(|sender| !sender.is_closed())
            && can_reuse_agy_session(
                &current,
                &cwd,
                mode,
                model.as_deref(),
                thinking_effort.as_deref(),
                capture.is_some(),
            );
        if !reused_agy {
            let readiness = self
                .provider_readiness_for(&provider, Some(&cwd.to_string_lossy()), model.as_deref())
                .await;
            if readiness.status != "ready" {
                return Err(format!("{} {}", readiness.message, readiness.recovery));
            }
            if capture.is_some() && !readiness.image_input {
                return Err("The selected provider model cannot accept an image.".into());
            }
            validate_runtime_options(&readiness, model.as_deref(), thinking_effort.as_deref())?;
        }
        if let Some(sender) = guard.as_ref().filter(|tx| !tx.is_closed()) {
            if std::path::Path::new(&current.cwd) != cwd.as_path() {
                return Err(
                    "Working context is fixed for this conversation. Restart Otto to change it."
                        .into(),
                );
            }

            if current.provider != provider {
                return Err("Provider is fixed for the conversation. Start a new session.".into());
            }
            if current.mode != mode.as_str() {
                return Err(
                    "Execution mode is fixed for this conversation. Start a new session to change it."
                        .into(),
                );
            }
            let run_id = self.next_run_id.fetch_add(1, Ordering::Relaxed) + 1;
            let permit = sender
                .try_reserve()
                .map_err(|_| "Agent provider is busy. Try again.".to_string())?;

            if let Some(marker) = &self.recovery {
                marker.mark(run_id);
            }
            if provider == "pi" {
                *self.selected_runtime.lock().unwrap() = ModelSelection {
                    model: model.clone(),
                    thinking_effort: thinking_effort.clone(),
                };
            }
            self.workspace_editing.store(false, Ordering::SeqCst);
            mutate(&self.updates, |s| {
                s.run_id = run_id;
                s.status = "starting".into();
                s.activity = None;
                s.approval = None;
                s.capture.phase = if capture_origin { "analyzing" } else { "idle" }.into();
                s.capture.error = None;
                s.error = None;
                s.model = model.clone();
                s.thinking_effort = thinking_effort.clone();
                s.usage = None;
            });
            permit.send(Control::Ask {
                text,
                cwd,
                run_id,
                model,
                thinking_effort,
                capture,
            });
            return Ok(());
        }
        let run_id = self.next_run_id.fetch_add(1, Ordering::Relaxed) + 1;
        if let Some(marker) = &self.recovery {
            marker.mark(run_id);
        }
        if provider == "pi" {
            *self.selected_runtime.lock().unwrap() = ModelSelection {
                model: model.clone(),
                thinking_effort: thinking_effort.clone(),
            };
        }
        self.workspace_editing.store(false, Ordering::SeqCst);
        mutate(&self.updates, |s| {
            s.run_id = run_id;
            s.status = "starting".into();
            s.mode = mode.as_str().into();
            s.provider = provider.clone();
            s.activity = None;
            s.approval = None;
            s.capture.phase = if capture_origin { "analyzing" } else { "idle" }.into();
            s.capture.error = None;
            s.error = None;
            s.cwd = cwd.to_string_lossy().into_owned();
            s.thread_id = None;
            s.model = model.clone();
            s.thinking_effort = thinking_effort.clone();
            s.usage = None;
            s.messages.clear();
        });
        let (tx, rx) = mpsc::channel(4);
        let updates = self.updates.clone();
        tauri::async_runtime::spawn(async move {
            let initial = Control::Ask {
                text,
                cwd,
                run_id,
                model,
                thinking_effort,
                capture,
            };
            selected.run(rx, updates, initial, mode).await;
        });
        *guard = Some(tx);
        Ok(())
    }

    pub async fn new_session(&self) -> Result<(), String> {
        self.new_session_with_timeout(Duration::from_secs(5)).await
    }

    async fn new_session_with_timeout(&self, close_timeout: Duration) -> Result<(), String> {
        let mut guard = self.control.lock().await;
        let current = self.snapshot();
        if matches!(
            current.status.as_str(),
            "starting" | "streaming" | "stopping" | "approvalRequired"
        ) {
            return Err("Stop the current request before starting a new session.".into());
        }

        if let Some(sender) = guard.as_ref()
            && !sender.is_closed()
        {
            let (finished, mut closed) = oneshot::channel();

            let claimed = Arc::new(AtomicBool::new(false));
            sender
                .try_send(Control::Close {
                    claimed: Arc::clone(&claimed),
                    finished,
                })
                .map_err(|_| "Agent provider is busy. Try again.".to_string())?;
            match timeout(close_timeout, &mut closed).await {
                Ok(Ok(())) => {}
                Ok(Err(_)) => {
                    return Err("Agent closed unexpectedly; session was not reset.".into());
                }
                Err(_) if !claimed.swap(true, Ordering::SeqCst) => {
                    return Err("Agent did not accept session close; session was not reset.".into());
                }
                Err(_) => {
                    return Err("Agent is still closing; session was not reset.".into());
                }
            }
        }
        *guard = None;
        *self.selected_runtime.lock().unwrap() = ModelSelection::default();
        self.workspace_editing.store(false, Ordering::SeqCst);
        if let Some(marker) = &self.recovery {
            marker.clear_if(current.run_id);
        }
        self.next_run_id
            .fetch_max(current.run_id, Ordering::Relaxed);
        let run_id = self.next_run_id.fetch_add(1, Ordering::Relaxed) + 1;
        mutate(&self.updates, |s| {
            s.run_id = run_id;
            s.status = "idle".into();
            s.mode = InteractionMode::QuickAsk.as_str().into();
            s.provider = current.provider.clone();
            s.thread_id = None;
            s.messages.clear();
            s.activity = None;
            s.approval = None;
            s.capture = CaptureSnapshot::default();
            s.error = None;
        });
        Ok(())
    }

    pub async fn decide_approval(
        &self,
        approval_id: String,
        decision: String,
    ) -> Result<(), String> {
        let decision = ApprovalDecision::parse(&decision)?;
        let guard = self.control.lock().await;
        let current = self.snapshot();
        if current.status != "approvalRequired" {
            return Err("There is no approval waiting for a decision.".into());
        }
        let pending = current
            .approval
            .as_ref()
            .ok_or("There is no approval waiting for a decision.")?;
        if pending.approval_id != approval_id || pending.run_id != current.run_id {
            return Err("That approval is no longer current. Ignored.".into());
        }
        let sender = guard.as_ref().ok_or("No active agent process.")?;
        let permit = sender
            .try_reserve()
            .map_err(|_| "Agent provider is busy. Try again.".to_string())?;

        permit.send(Control::Decide {
            approval_id,
            decision,
        });
        Ok(())
    }

    pub async fn stop(&self) -> Result<(), String> {
        let guard = self.control.lock().await;
        if !matches!(
            self.snapshot().status.as_str(),
            "starting" | "streaming" | "approvalRequired"
        ) {
            return Err("No active agent turn.".into());
        }
        let sender = guard.as_ref().ok_or("No active agent process.")?;
        let permit = sender
            .try_reserve()
            .map_err(|_| "Agent is busy; retry Stop.".to_string())?;

        mutate(&self.updates, |s| {
            if matches!(
                s.status.as_str(),
                "starting" | "streaming" | "approvalRequired"
            ) {
                s.status = "stopping".into();
                s.approval = None;
                s.activity = None;
            }
        });
        permit.send(Control::Stop);
        Ok(())
    }
}

fn can_reuse_agy_session(
    snapshot: &Snapshot,
    cwd: &std::path::Path,
    mode: InteractionMode,
    model: Option<&str>,
    thinking_effort: Option<&str>,
    has_capture: bool,
) -> bool {
    snapshot.provider == "agy"
        && snapshot.status == "completed"
        && snapshot.thread_id.is_some()
        && snapshot.mode == mode.as_str()
        && mode == InteractionMode::QuickAsk
        && std::path::Path::new(&snapshot.cwd) == cwd
        && model.is_none()
        && thinking_effort.is_none()
        && !has_capture
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

pub(crate) fn mutate(updates: &watch::Sender<Snapshot>, action: impl FnOnce(&mut Snapshot)) {
    updates.send_modify(|snapshot| {
        action(snapshot);
        snapshot.seq = snapshot.seq.saturating_add(1);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agy_reuse_requires_a_completed_unchanged_quick_ask() {
        let cwd = std::fs::canonicalize(std::env::current_dir().unwrap()).unwrap();
        let runtime = AgentRuntime::new();
        let mut snapshot = runtime.snapshot();
        snapshot.provider = "agy".into();
        snapshot.status = "completed".into();
        snapshot.mode = "quickAsk".into();
        snapshot.thread_id = Some("agy-conversation".into());
        snapshot.cwd = cwd.to_string_lossy().into_owned();

        let eligible = |snapshot: &Snapshot, cwd: &std::path::Path, model: Option<&str>| {
            can_reuse_agy_session(
                snapshot,
                cwd,
                InteractionMode::QuickAsk,
                model,
                None,
                false,
            )
        };
        assert!(eligible(&snapshot, &cwd, None));
        assert!(!eligible(&snapshot, &cwd, Some("different-model")));
        assert!(!can_reuse_agy_session(
            &snapshot,
            &cwd,
            InteractionMode::QuickAsk,
            None,
            Some("high"),
            false,
        ));
        assert!(!can_reuse_agy_session(
            &snapshot,
            &cwd,
            InteractionMode::QuickAsk,
            None,
            None,
            true,
        ));
        assert!(!can_reuse_agy_session(
            &snapshot,
            &cwd,
            InteractionMode::AgentSession,
            None,
            None,
            false,
        ));
        assert!(!eligible(&snapshot, &cwd.join("different"), None));
        snapshot.thread_id = None;
        assert!(!eligible(&snapshot, &cwd, None));
        snapshot.thread_id = Some("agy-conversation".into());
        snapshot.status = "failed".into();
        assert!(!eligible(&snapshot, &cwd, None));
        snapshot.status = "completed".into();
        snapshot.provider = "pi".into();
        assert!(!eligible(&snapshot, &cwd, None));
    }

    #[tokio::test]
    async fn completed_agy_followup_uses_owned_runtime_without_reprobing_cli() {
        let runtime = AgentRuntime::new();
        runtime.select_provider("agy".into()).await.unwrap();
        let cwd = std::fs::canonicalize(std::env::current_dir().unwrap()).unwrap();
        mutate(&runtime.updates, |state| {
            state.status = "completed".into();
            state.mode = "quickAsk".into();
            state.thread_id = Some("agy-conversation".into());
            state.cwd = cwd.to_string_lossy().into_owned();
        });
        let (sender, mut receiver) = mpsc::channel(2);
        *runtime.control.lock().await = Some(sender);
        runtime
            .ask(
                "continue the explanation".into(),
                cwd.to_string_lossy().into_owned(),
                "quickAsk".into(),
                "agy".into(),
                None,
                None,
            )
            .await
            .expect("a completed Agy conversation must not require another CLI probe");
        assert!(matches!(receiver.try_recv(), Ok(Control::Ask { .. })));
        assert_eq!(runtime.snapshot().status, "starting");
    }

    #[tokio::test]
    async fn workspace_requires_confirmed_existing_directory() {
        let runtime = AgentRuntime::new();
        let original = runtime.snapshot().cwd;
        runtime.begin_workspace_edit().unwrap();
        assert!(runtime.workspace_editing.load(Ordering::SeqCst));
        assert!(runtime.commit_workspace(String::new()).await.is_err());
        assert_eq!(runtime.snapshot().cwd, original);
        assert!(runtime.workspace_editing.load(Ordering::SeqCst));
        let confirmed = runtime.commit_workspace("~".into()).await.unwrap();
        assert_eq!(runtime.snapshot().cwd, confirmed);
        assert!(!runtime.workspace_editing.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn active_conversation_cannot_change_working_directory() {
        let runtime = AgentRuntime::new();
        let original = runtime.snapshot().cwd;
        mutate(&runtime.updates, |state| state.status = "streaming".into());
        assert!(runtime.begin_workspace_edit().is_err());
        assert!(runtime.commit_workspace("~".into()).await.is_err());
        assert_eq!(runtime.snapshot().cwd, original);
    }

    #[cfg(windows)]
    #[test]
    fn editing_project_prevents_hotkey_from_using_stale_directory() {
        let runtime = AgentRuntime::new();
        runtime.begin_workspace_edit().unwrap();
        assert!(runtime.begin_capture().is_err());
        runtime.cancel_workspace_edit();
        assert!(runtime.begin_capture().is_ok());
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

    #[tokio::test]
    async fn cannot_change_pi_runtime_while_running() {
        let runtime = AgentRuntime::new();
        mutate(&runtime.updates, |state| {
            state.provider = "pi".into();
            state.status = "streaming".into();
        });
        assert!(runtime.select_runtime_options(Some("pi/model".into()), None).await.is_err());
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
            mode: "quickAsk".into(),
            provider: "codex".into(),
            cwd: String::new(),
            thread_id: None,
            model: None,
            thinking_effort: None,
            usage: None,
            messages: vec![],
            activity: None,
            approval: None,
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
        assert!(runtime.select_provider("pi".into()).await.is_err());
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
    async fn stale_or_unknown_approval_is_rejected() {
        let runtime = AgentRuntime::new();
        let (tx, mut rx) = mpsc::channel(2);
        *runtime.control.lock().await = Some(tx);

        assert!(
            runtime
                .decide_approval("appr-1".into(), "allowOnce".into())
                .await
                .is_err()
        );
        mutate(&runtime.updates, |s| {
            s.status = "approvalRequired".into();
            s.mode = "agentSession".into();
            s.run_id = 4;
            s.approval = Some(session::PendingApproval {
                approval_id: "appr-1".into(),
                run_id: 4,
                kind: "command".into(),
                title: "Run command".into(),
                detail: "npm test".into(),
                reason: None,
            });
        });

        assert!(
            runtime
                .decide_approval("appr-9".into(), "allowOnce".into())
                .await
                .is_err()
        );
        assert!(
            runtime
                .decide_approval("appr-1".into(), "accept".into())
                .await
                .is_err()
        );
        assert!(rx.try_recv().is_err());

        runtime
            .decide_approval("appr-1".into(), "deny".into())
            .await
            .expect("valid decision");
        assert_eq!(runtime.snapshot().status, "approvalRequired");
        assert_eq!(
            runtime.snapshot().approval.as_ref().unwrap().approval_id,
            "appr-1"
        );
        assert!(matches!(rx.try_recv(), Ok(Control::Decide { .. })));
        events::ProviderEvents::new(runtime.updates.clone()).emit(
            events::AgentEvent::ApprovalResolved {
                run_id: 4,
                approval_id: "appr-1".into(),
            },
        );
        assert_eq!(runtime.snapshot().status, "starting");
        events::ProviderEvents::new(runtime.updates.clone()).emit(
            events::AgentEvent::TurnStarted {
                run_id: 4,
                text: "respond".into(),
            },
        );
        assert_eq!(runtime.snapshot().status, "streaming");
        assert_eq!(
            runtime.snapshot().messages.last().unwrap().role,
            "assistant"
        );

        assert!(
            runtime
                .decide_approval("appr-1".into(), "deny".into())
                .await
                .is_err()
        );
        assert!(rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn new_session_closes_provider_before_clearing_conversation() {
        let runtime = AgentRuntime::new();
        let (sender, mut receiver) = mpsc::channel(2);
        *runtime.control.lock().await = Some(sender);
        mutate(&runtime.updates, |s| {
            s.run_id = 8;
            s.status = "completed".into();
            s.mode = "agentSession".into();
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
        assert_eq!(snapshot.mode, "quickAsk");
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
    async fn new_session_cannot_discard_running_or_pending_approval() {
        let runtime = AgentRuntime::new();
        for status in ["starting", "streaming", "stopping", "approvalRequired"] {
            mutate(&runtime.updates, |s| s.status = status.into());
            assert!(runtime.new_session().await.is_err(), "{status}");
            assert_eq!(runtime.snapshot().status, status);
        }
    }

    #[tokio::test]
    async fn mode_is_fixed_for_an_existing_conversation() {
        let runtime = AgentRuntime::new();
        let (tx, _rx) = mpsc::channel(4);
        *runtime.control.lock().await = Some(tx);
        mutate(&runtime.updates, |s| {
            s.mode = "quickAsk".into();
            s.cwd = std::env::current_dir()
                .unwrap()
                .to_string_lossy()
                .into_owned();
        });
        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let escalated = runtime
            .ask(
                "edit files".into(),
                cwd,
                "agentSession".into(),
                "codex".into(),
                None,
                None,
            )
            .await;
        assert!(escalated.is_err());
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn timed_out_capture_keeps_native_work_reserved_until_it_finishes() {
        let in_flight = Arc::new(AtomicBool::new(false));
        let reservation =
            Arc::new(CaptureReservation::acquire(Arc::clone(&in_flight)).unwrap());
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
