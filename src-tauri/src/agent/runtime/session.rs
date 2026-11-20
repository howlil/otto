use crate::agent::conversation as history;
use crate::agent::*;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;
use tokio::sync::{MutexGuard, mpsc, oneshot, watch};
use tokio::time::timeout;

impl AgentRuntime {
    pub async fn new_session(&self) -> Result<(), String> {
        self.new_session_with_timeout(Duration::from_secs(5)).await
    }

    pub async fn shutdown(&self) {
        self.cancel_run_readiness();
        self.clear_staged_capture();
        self.drop_queued_followup();
        let mut guard = self.control.lock().await;
        if let Some(sender) = guard.take() {
            let _ = close_owned_transport(&sender, Duration::from_secs(2)).await;
        }
    }

    pub(crate) async fn new_session_with_timeout(
        &self,
        close_timeout: Duration,
    ) -> Result<(), String> {
        let mut guard = self.control.lock().await;
        self.new_session_locked(&mut guard, close_timeout).await
    }

    pub(crate) async fn new_session_locked(
        &self,
        guard: &mut MutexGuard<'_, Option<mpsc::Sender<Control>>>,
        close_timeout: Duration,
    ) -> Result<(), String> {
        let current = self.snapshot();
        ensure_session_can_reset(&current)?;
        if let Some(sender) = guard.as_ref().filter(|sender| !sender.is_closed()) {
            close_owned_transport(sender, close_timeout).await?;
        }
        self.persist_current_snapshot(current.status != RunPhase::Completed)?;
        let mut active_id = self
            .conversation
            .id
            .lock()
            .map_err(|_| "Conversation history is unavailable.")?;
        self.rotate_session_locked(guard, &current, &mut active_id);
        Ok(())
    }

    pub(crate) fn rotate_session_locked(
        &self,
        guard: &mut MutexGuard<'_, Option<mpsc::Sender<Control>>>,
        current: &Snapshot,
        active_id: &mut String,
    ) {
        **guard = None;
        *self.selected_runtime.lock().unwrap() = ModelSelection::default();
        self.clear_session_guidance();
        if let Ok(mut staged) = self.staged_capture.lock() {
            *staged = None;
        }
        if let Ok(mut queue) = self.followup_queue.lock() {
            queue.item = None;
            queue.watching_run_id = None;
        }
        let clear_failed = self
            .recovery
            .as_ref()
            .is_some_and(|marker| marker.clear_if(current.run_id).is_err());
        self.next_run_id
            .fetch_max(current.run_id, Ordering::Relaxed);
        let run_id = self.next_run_id.fetch_add(1, Ordering::Relaxed) + 1;
        let next_conversation = history::new_id();
        *active_id = next_conversation.clone();
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
            s.activity.clear();
            s.capture = CaptureSnapshot::default();
            s.queued_followup = None;
            s.pending_permission = None;
            s.error = clear_failed.then(|| MARKER_CLEAR_NOTICE.into());
        });
    }
}

pub(super) async fn wait_for_terminal_run(mut watcher: watch::Receiver<Snapshot>, run_id: u64) {
    loop {
        {
            let state = watcher.borrow();
            if (state.run_id == run_id
                && matches!(
                    state.status,
                    RunPhase::Completed | RunPhase::Stopped | RunPhase::Failed
                ))
                || state.run_id > run_id
            {
                return;
            }
        }
        if watcher.changed().await.is_err() {
            return;
        }
    }
}

pub(super) fn spawn_provider_run(
    selected: ProviderId,
    updates: watch::Sender<Snapshot>,
    initial: Control,
    ephemeral: bool,
) -> mpsc::Sender<Control> {
    let (tx, rx) = mpsc::channel(4);
    if !ephemeral {
        let events = crate::agent::events::ProviderEvents::new(updates);
        tokio::spawn(async move {
            selected.run(rx, events, initial).await;
        });
        return tx;
    }
    let run_id = match &initial {
        Control::Ask { run_id, .. } => *run_id,
        _ => 0,
    };
    let watcher = updates.subscribe();
    let events = crate::agent::events::ProviderEvents::new_ephemeral(updates);
    let close_tx = tx.clone();
    tokio::spawn(async move {
        let (done_tx, done_rx) = oneshot::channel::<()>();
        let waiter = async {
            tokio::select! {
                _ = done_rx => {}
                _ = wait_for_terminal_run(watcher, run_id) => {
                    let _ = close_owned_transport(&close_tx, Duration::from_secs(5)).await;
                }
            }
        };
        tokio::join!(
            async {
                selected.run(rx, events, initial).await;
                let _ = done_tx.send(());
            },
            waiter
        );
    });
    tx
}

pub(super) async fn close_owned_transport(
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

pub(crate) fn ensure_session_can_reset(current: &Snapshot) -> Result<(), String> {
    if matches!(
        current.status,
        RunPhase::Starting | RunPhase::Streaming | RunPhase::Stopping
    ) {
        return Err("Stop the current request before starting a new session.".into());
    }
    if !matches!(current.capture.phase.as_str(), "idle" | "failed") {
        return Err("Finish screen capture before starting a new session.".into());
    }
    Ok(())
}
