use super::AgentRuntime;
use crate::agent::{
    MARKER_CLEAR_NOTICE, RunPhase, Snapshot, conversation as history, error::AgentError, mutate,
};
use std::{
    fs,
    future::Future,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tokio::sync::watch;

#[derive(Clone)]
pub struct RecoveryMarker {
    path: PathBuf,
    access: Arc<Mutex<()>>,
}

impl RecoveryMarker {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            access: Arc::new(Mutex::new(())),
        }
    }

    pub fn take_interrupted(&self) -> bool {
        let Ok(_guard) = self.access.lock() else {
            return false;
        };
        if !self.path.is_file() {
            return false;
        }
        let _ = fs::remove_file(&self.path);
        true
    }

    pub fn mark(&self, run_id: u64) -> Result<(), AgentError> {
        let _guard = self
            .access
            .lock()
            .map_err(|_| AgentError::internal("Recovery marker is unavailable."))?;
        if let Some(parent) = self.path.parent()
            && fs::create_dir_all(parent).is_err()
        {
            return Err(AgentError::persistence_failed(
                "Recovery marker could not be created.",
            ));
        }
        fs::write(&self.path, run_id.to_string())
            .map_err(|_| AgentError::persistence_failed("Recovery marker could not be written."))?;
        Ok(())
    }

    pub fn clear_if(&self, run_id: u64) -> Result<bool, AgentError> {
        let _guard = self
            .access
            .lock()
            .map_err(|_| AgentError::internal("Recovery marker is unavailable."))?;
        let owned = fs::read_to_string(&self.path)
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            == Some(run_id);
        if !owned {
            return Ok(false);
        }
        fs::remove_file(&self.path).map_err(|_| {
            AgentError::persistence_failed(
                "Recovery marker could not be cleared; a restart may report an interrupted request.",
            )
        })?;
        Ok(true)
    }
}

impl AgentRuntime {
    pub(crate) fn recovery_observer(&self) -> Option<impl Future<Output = ()> + Send + 'static> {
        let marker = self.recovery.clone()?;
        let conversation = Arc::clone(&self.conversation);
        let readiness_cache = Arc::clone(&self.readiness_cache);
        let mut receiver = self.subscribe_updates();
        let updates = self.updates.clone();
        Some(async move {
            while receiver.changed().await.is_ok() {
                let snapshot = {
                    let state = receiver.borrow_and_update();
                    if !is_terminal_phase(state.status) {
                        continue;
                    }
                    state.clone()
                };
                if snapshot.status == RunPhase::Failed
                    && should_invalidate_cache_for_error(snapshot.error.as_deref())
                {
                    readiness_cache.invalidate(snapshot.provider);
                }
                let conversation = Arc::clone(&conversation);
                let marker = marker.clone();
                let updates = updates.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    persist_terminal_outcome(&conversation, &marker, &updates, &snapshot);
                })
                .await;
            }
        })
    }
}

pub(crate) fn is_terminal_phase(phase: RunPhase) -> bool {
    matches!(
        phase,
        RunPhase::Completed | RunPhase::Failed | RunPhase::Stopped
    )
}

pub(crate) fn should_invalidate_cache_for_error(error: Option<&str>) -> bool {
    let Some(detail) = error else {
        return false;
    };
    let lower = detail.to_ascii_lowercase();
    [
        "sign in",
        "login",
        "authentication",
        "not found",
        "not installed",
        "unavailable",
        "unsupported",
        "model",
    ]
    .iter()
    .any(|signal| lower.contains(signal))
}

pub(crate) fn persist_terminal_outcome(
    conversation: &crate::agent::conversation::ConversationOwner,
    marker: &RecoveryMarker,
    updates: &watch::Sender<Snapshot>,
    snapshot: &Snapshot,
) {
    if !is_terminal_phase(snapshot.status) || updates.borrow().run_id != snapshot.run_id {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn marker() -> RecoveryMarker {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        RecoveryMarker::new(
            std::env::temp_dir().join(format!("otto-recovery-test-{}-{nonce}", std::process::id())),
        )
    }

    #[test]
    fn active_marker_recovers_once_without_storing_conversation() {
        let marker = marker();
        marker.mark(7).unwrap();
        assert_eq!(fs::read_to_string(&marker.path).unwrap(), "7");
        assert!(marker.take_interrupted());
        assert!(!marker.take_interrupted());
    }

    #[test]
    fn late_terminal_event_cannot_clear_a_new_run() {
        let marker = marker();
        marker.mark(7).unwrap();
        marker.mark(8).unwrap();
        assert!(!marker.clear_if(7).unwrap());
        assert_eq!(fs::read_to_string(&marker.path).unwrap(), "8");
        assert!(marker.clear_if(8).unwrap());
        assert!(!marker.path.exists());
    }

    #[cfg(windows)]
    #[test]
    fn clear_if_reports_delete_failure_instead_of_losing_the_marker_silently() {
        const FILE_SHARE_READ: u32 = 0x1;
        const FILE_SHARE_WRITE: u32 = 0x2;
        use std::os::windows::fs::OpenOptionsExt;
        let marker = marker();
        marker.mark(9).unwrap();
        let held = fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .open(&marker.path)
            .unwrap();
        let outcome = marker.clear_if(9);
        drop(held);
        assert!(matches!(outcome, Err(AgentError::PersistenceFailed(_))));
        assert_eq!(fs::read_to_string(&marker.path).unwrap(), "9");
        marker.clear_if(9).unwrap();
        assert!(!marker.path.exists());
    }

    #[test]
    fn marker_write_failure_is_reported() {
        let parent = std::env::temp_dir().join(format!(
            "otto-recovery-file-parent-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::write(&parent, b"not a directory").unwrap();
        let marker = RecoveryMarker::new(parent.join("marker"));

        assert!(marker.mark(7).is_err());
        fs::remove_file(parent).unwrap();
    }

    #[test]
    fn cache_invalidation_heuristic_catches_auth_and_model_failures_only() {
        assert!(should_invalidate_cache_for_error(Some(
            "Codex authentication expired. Sign in to Codex."
        )));
        assert!(should_invalidate_cache_for_error(Some(
            "Selected model is unavailable."
        )));
        assert!(!should_invalidate_cache_for_error(Some(
            "Codex turn did not complete."
        )));
        assert!(!should_invalidate_cache_for_error(None));
    }

    #[test]
    fn terminal_phase_filter_skips_streaming_updates() {
        assert!(!is_terminal_phase(RunPhase::Idle));
        assert!(!is_terminal_phase(RunPhase::Starting));
        assert!(!is_terminal_phase(RunPhase::Streaming));
        assert!(!is_terminal_phase(RunPhase::Stopping));
        assert!(is_terminal_phase(RunPhase::Completed));
        assert!(is_terminal_phase(RunPhase::Failed));
        assert!(is_terminal_phase(RunPhase::Stopped));
    }
}
