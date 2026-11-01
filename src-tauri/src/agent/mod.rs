mod events;
mod policy;
mod providers;
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
pub struct ProviderReadiness {
    pub status: String,
    pub message: String,
    pub recovery: String,

    pub image_input: bool,
    pub agent_session: bool,
    pub image_transport: bool,
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
    pub messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activity: Option<session::ToolActivity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval: Option<PendingApproval>,
    pub error: Option<String>,
}

#[cfg(windows)]
struct CaptureReservation<'a>(&'a AtomicBool);

#[cfg(windows)]
impl<'a> CaptureReservation<'a> {
    fn acquire(in_flight: &'a AtomicBool) -> Result<Self, String> {
        in_flight
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "Screen capture is already in progress.".to_string())?;
        Ok(Self(in_flight))
    }
}

#[cfg(windows)]
impl Drop for CaptureReservation<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
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
    next_run_id: AtomicU64,
    subscriptions: StdMutex<Option<(u64, oneshot::Sender<()>)>>,
    next_subscription_id: AtomicU64,
    recovery: Option<recovery::RecoveryMarker>,
    #[cfg(windows)]
    capture_in_flight: AtomicBool,
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
        let cwd = std::env::current_dir()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        let (updates, _) = watch::channel(Snapshot {
            run_id: 0,
            seq: u64::from(interrupted),
            status: if interrupted { "failed" } else { "idle" }.into(),
            mode: InteractionMode::QuickAsk.as_str().into(),
            provider: "codex".into(),
            cwd,
            thread_id: None,
            messages: Vec::new(),
            activity: None,
            approval: None,
            error: interrupted.then(|| {
                "Previous agent request may have been interrupted. No answer was restored. Ask again to start a new session.".into()
            }),
        });
        Self {
            updates,
            control: Mutex::new(None),
            next_run_id: AtomicU64::new(0),
            subscriptions: StdMutex::new(None),
            next_subscription_id: AtomicU64::new(0),
            recovery,
            #[cfg(windows)]
            capture_in_flight: AtomicBool::new(false),
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
            mutate(&self.updates, |state| {
                state.provider = provider;
                state.error = None;
            });
        }
        Ok(())
    }

    pub async fn provider_readiness(
        &self,
        provider: &str,
        requested_cwd: Option<&str>,
    ) -> ProviderReadiness {
        let Some(provider) = ProviderId::parse(provider) else {
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
        let Ok(cwd) = std::fs::canonicalize(directory) else {
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
        provider.readiness(&cwd).await
    }

    pub async fn codex_readiness(&self, requested_cwd: Option<&str>) -> ProviderReadiness {
        self.provider_readiness(ProviderId::Codex.as_str(), requested_cwd)
            .await
    }

    #[cfg(windows)]
    pub async fn capture_hotkey<F>(&self, capture: F) -> Result<(), String>
    where
        F: FnOnce() -> Result<CapturedImage, String> + Send + 'static,
    {
        let _reservation = CaptureReservation::acquire(&self.capture_in_flight)?;
        let state = self.snapshot();
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
        let ready = self
            .provider_readiness(&state.provider, Some(&state.cwd))
            .await;
        if ready.status != "ready" || !ready.image_input {
            return Err(
                "Selected provider or model cannot accept screenshots. Open Agent settings and Retry."
                    .into(),
            );
        }
        let image = tokio::task::spawn_blocking(capture)
            .await
            .map_err(|_| "Windows capture failed.".to_string())??;
        self.ask_with_capture(
            "Analyze the captured application window. Describe what is visible and answer any apparent question without modifying files.".into(),
            state.cwd,
            "quickAsk".into(),
            state.provider,
            Some(image),
        ).await
    }

    #[cfg(windows)]
    pub fn capture_error(&self, reason: &str) {
        if reason == "Screen capture is already in progress." {
            return;
        }
        mutate(&self.updates, |s| {
            if !matches!(
                s.status.as_str(),
                "starting" | "streaming" | "stopping" | "approvalRequired"
            ) {
                s.status = "failed".into();
                s.error = Some(format!("Capture: {reason}"));
            }
        });
    }

    #[cfg(windows)]
    pub fn clear_capture_error(&self) {
        mutate(&self.updates, |s| {
            if s.status == "failed"
                && s.error
                    .as_deref()
                    .is_some_and(|error| error.starts_with("Capture: "))
            {
                s.status = if s.thread_id.is_some() {
                    "completed".into()
                } else {
                    "idle".into()
                };
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
    ) -> Result<(), String> {
        self.ask_with_capture(text, cwd, mode, provider, None).await
    }

    async fn ask_with_capture(
        &self,
        text: String,
        cwd: String,
        mode: String,
        provider: String,
        capture: Option<CapturedImage>,
    ) -> Result<(), String> {
        let text = text.trim().to_owned();
        if text.is_empty() || text.len() > 12_000 {
            return Err("Enter a question (up to 12,000 bytes).".into());
        }
        let mode = InteractionMode::parse(&mode)?;
        let selected = ProviderId::parse(&provider).ok_or("Selected provider is unavailable.")?;
        selected.validate(mode, capture.is_some())?;
        let cwd =
            std::fs::canonicalize(cwd).map_err(|_| "Working folder does not exist.".to_string())?;
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

        let readiness = self
            .provider_readiness(&provider, Some(&cwd.to_string_lossy()))
            .await;
        if readiness.status != "ready" {
            return Err(format!("{} {}", readiness.message, readiness.recovery));
        }
        if capture.is_some() && !readiness.image_input {
            return Err("The selected provider model cannot accept an image.".into());
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
            mutate(&self.updates, |s| {
                s.run_id = run_id;
                s.status = "starting".into();
                s.activity = None;
                s.approval = None;
                s.error = None;
            });
            permit.send(Control::Ask {
                text,
                cwd,
                run_id,
                capture,
            });
            return Ok(());
        }
        let run_id = self.next_run_id.fetch_add(1, Ordering::Relaxed) + 1;
        if let Some(marker) = &self.recovery {
            marker.mark(run_id);
        }
        mutate(&self.updates, |s| {
            s.run_id = run_id;
            s.status = "starting".into();
            s.mode = mode.as_str().into();
            s.provider = provider.clone();
            s.activity = None;
            s.approval = None;
            s.error = None;
            s.cwd = cwd.to_string_lossy().into_owned();
            s.thread_id = None;
            s.messages.clear();
        });
        let (tx, rx) = mpsc::channel(4);
        let updates = self.updates.clone();
        tauri::async_runtime::spawn(async move {
            let initial = Control::Ask {
                text,
                cwd,
                run_id,
                capture,
            };
            selected.run(rx, updates, initial, mode).await;
        });
        *guard = Some(tx);
        Ok(())
    }

    pub async fn new_session(&self) -> Result<(), String> {
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
            match timeout(Duration::from_secs(5), &mut closed).await {
                Ok(Ok(())) => {}
                Ok(Err(_)) => {
                    return Err("Codex closed unexpectedly; session was not reset.".into());
                }
                Err(_) if !claimed.swap(true, Ordering::SeqCst) => {
                    return Err("Codex did not accept session close; session was not reset.".into());
                }
                Err(_) => {
                    closed
                        .await
                        .map_err(|_| "Codex closed unexpectedly; session was not reset.")?;
                }
            }
        }
        *guard = None;
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

        mutate(&self.updates, |s| {
            if s.status == "approvalRequired" {
                s.status = "streaming".into();
                s.approval = None;
                s.activity = None;
            }
        });
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

pub(crate) fn mutate(updates: &watch::Sender<Snapshot>, action: impl FnOnce(&mut Snapshot)) {
    updates.send_modify(|snapshot| {
        action(snapshot);
        snapshot.seq = snapshot.seq.saturating_add(1);
    });
}

pub(crate) fn fail(updates: &watch::Sender<Snapshot>, run_id: u64, message: &str) {
    mutate(updates, |s| {
        if s.run_id == run_id && s.status != "stopped" && s.status != "completed" {
            s.status = "failed".into();
            s.error = Some(message.to_owned());
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn duplicate_hotkey_never_overwrites_an_active_capture_status() {
        let runtime = AgentRuntime::new();
        runtime.capture_error("Screen capture is already in progress.");
        assert_eq!(runtime.snapshot().status, "idle");
        assert!(runtime.snapshot().error.is_none());
    }

    #[cfg(windows)]
    #[test]
    fn capture_reservation_rejects_overlap_and_releases_on_drop() {
        let in_flight = AtomicBool::new(false);
        let first = CaptureReservation::acquire(&in_flight).expect("first trigger accepted");
        assert!(CaptureReservation::acquire(&in_flight).is_err());
        drop(first);
        let again = CaptureReservation::acquire(&in_flight).expect("retry accepted");
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
            messages: vec![],
            activity: None,
            approval: None,
            error: None,
        });
        fail(&tx, 1, "late failure");
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
        let capture = runtime
            .capture_hotkey(|| -> Result<CapturedImage, String> {
                panic!("The capture closure must never execute for unsupported Agy images");
            })
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
        assert_eq!(runtime.snapshot().status, "streaming");
        assert!(runtime.snapshot().approval.is_none());
        assert!(matches!(rx.try_recv(), Ok(Control::Decide { .. })));

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
            )
            .await;
        assert!(escalated.is_err());
    }
}
