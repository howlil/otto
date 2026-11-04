use super::run::close_owned_transport;
use crate::agent::*;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tokio::sync::MutexGuard;
use tokio::sync::mpsc;

impl AgentRuntime {
    pub async fn new_session(&self) -> Result<(), String> {
        self.new_session_with_timeout(Duration::from_secs(5)).await
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
            s.capture = CaptureSnapshot::default();
            s.error = clear_failed.then(|| MARKER_CLEAR_NOTICE.into());
        });
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
