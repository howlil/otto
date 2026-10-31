mod policy;
mod providers;
pub mod session;

use policy::InteractionMode;
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
}

impl ProviderReadiness {
    pub fn new(status: &str, message: &str, recovery: &str) -> Self {
        Self {
            status: status.into(),
            message: message.into(),
            recovery: recovery.into(),
            image_input: false,
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
    pub cwd: String,
    pub thread_id: Option<String>,
    pub messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activity: Option<session::ToolActivity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval: Option<PendingApproval>,
    pub error: Option<String>,
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
}

impl AgentRuntime {
    pub fn new() -> Self {
        let cwd = std::env::current_dir()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        let (updates, _) = watch::channel(Snapshot {
            run_id: 0,
            seq: 0,
            status: "idle".into(),
            mode: InteractionMode::QuickAsk.as_str().into(),
            cwd,
            thread_id: None,
            messages: Vec::new(),
            activity: None,
            approval: None,
            error: None,
        });
        Self {
            updates,
            control: Mutex::new(None),
            next_run_id: AtomicU64::new(0),
            subscriptions: StdMutex::new(None),
            next_subscription_id: AtomicU64::new(0),
        }
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

    pub async fn codex_readiness(&self, requested_cwd: Option<&str>) -> ProviderReadiness {
        let snapshot = self.snapshot();
        let directory = requested_cwd
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(&snapshot.cwd);
        let Ok(cwd) = std::fs::canonicalize(directory) else {
            return ProviderReadiness::new(
                "unavailable",
                "Working project folder does not exist.",
                "Select a valid project folder, then Retry.",
            );
        };
        if !cwd.is_dir() {
            return ProviderReadiness::new(
                "unavailable",
                "Working project must be a folder.",
                "Select a valid project folder, then Retry.",
            );
        }
        providers::codex::readiness(&cwd).await
    }

    #[cfg(windows)]
    pub async fn capture_hotkey(
        &self,
        hwnd: isize,
        capture: fn(isize) -> Result<CapturedImage, String>,
    ) -> Result<(), String> {
        let state = self.snapshot();
        if matches!(
            state.status.as_str(),
            "starting" | "streaming" | "stopping" | "approvalRequired"
        ) {
            return Err("Finish or Stop the current answer before capturing.".into());
        }
        if state.thread_id.is_some() && state.mode != "quickAsk" {
            return Err("Start a new Quick Ask session before using screen capture.".into());
        }
        let ready = self.codex_readiness(Some(&state.cwd)).await;
        if ready.status != "ready" || !ready.image_input {
            return Err(
                "Codex image input is not confirmed. Open Agent settings and Retry.".into(),
            );
        }
        let image = tokio::task::spawn_blocking(move || capture(hwnd))
            .await
            .map_err(|_| "Windows capture failed.".to_string())??;
        self.ask_with_capture(
            "Analyze the captured application window. Describe what is visible and answer any apparent question without modifying files.".into(),
            state.cwd,
            "quickAsk".into(),
            Some(image),
        ).await
    }

    #[cfg(windows)]
    pub fn capture_error(&self, reason: &str) {
        mutate(&self.updates, |s| {
            if !matches!(
                s.status.as_str(),
                "starting" | "streaming" | "stopping" | "approvalRequired"
            ) {
                s.status = "failed".into();
                s.error = Some(reason.into());
            }
        });
    }

    pub async fn ask(&self, text: String, cwd: String, mode: String) -> Result<(), String> {
        self.ask_with_capture(text, cwd, mode, None).await
    }

    async fn ask_with_capture(
        &self,
        text: String,
        cwd: String,
        mode: String,
        capture: Option<CapturedImage>,
    ) -> Result<(), String> {
        let text = text.trim().to_owned();
        if text.is_empty() || text.len() > 12_000 {
            return Err("Enter a question (up to 12,000 bytes).".into());
        }
        let mode = InteractionMode::parse(&mode)?;
        let cwd =
            std::fs::canonicalize(cwd).map_err(|_| "Working folder does not exist.".to_string())?;
        if !cwd.is_dir() {
            return Err("Working context must be a folder.".into());
        }
        if !self.codex_installed() {
            return Err("Codex executable not found. Install Codex CLI, then retry.".into());
        }
        let mut guard = self.control.lock().await;
        let current = self.snapshot();
        if matches!(
            current.status.as_str(),
            "starting" | "streaming" | "stopping" | "approvalRequired"
        ) {
            return Err("An answer is already running.".into());
        }

        let readiness = providers::codex::readiness(&cwd).await;
        if readiness.status != "ready" {
            return Err(format!("{} {}", readiness.message, readiness.recovery));
        }
        if capture.is_some() && !readiness.image_input {
            return Err("The selected Codex model cannot accept an image.".into());
        }
        if let Some(sender) = guard.as_ref().filter(|tx| !tx.is_closed()) {
            if std::path::Path::new(&current.cwd) != cwd.as_path() {
                return Err(
                    "Working context is fixed for this conversation. Restart Otto to change it."
                        .into(),
                );
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
                .map_err(|_| "Codex is busy. Try again.".to_string())?;

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
        mutate(&self.updates, |s| {
            s.run_id = run_id;
            s.status = "starting".into();
            s.mode = mode.as_str().into();
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
            providers::codex::run(
                rx,
                updates.clone(),
                Control::Ask {
                    text,
                    cwd,
                    run_id,
                    capture,
                },
                mode,
            )
            .await;
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
                .map_err(|_| "Codex is busy. Try again.".to_string())?;
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
        self.next_run_id
            .fetch_max(current.run_id, Ordering::Relaxed);
        let run_id = self.next_run_id.fetch_add(1, Ordering::Relaxed) + 1;
        mutate(&self.updates, |s| {
            s.run_id = run_id;
            s.status = "idle".into();
            s.mode = InteractionMode::QuickAsk.as_str().into();
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
        let sender = guard.as_ref().ok_or("No active Codex process.")?;
        let permit = sender
            .try_reserve()
            .map_err(|_| "Codex is busy. Try again.".to_string())?;

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
            return Err("No active Codex turn.".into());
        }
        let sender = guard.as_ref().ok_or("No active Codex process.")?;
        let permit = sender
            .try_reserve()
            .map_err(|_| "Codex is busy; retry Stop.".to_string())?;

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

    #[test]
    fn old_run_cannot_replace_new_terminal_state() {
        let (tx, _) = watch::channel(Snapshot {
            run_id: 2,
            seq: 4,
            status: "completed".into(),
            mode: "quickAsk".into(),
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
            .ask("edit files".into(), cwd, "agentSession".into())
            .await;
        assert!(escalated.is_err());
    }
}
