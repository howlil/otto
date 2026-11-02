use super::error::AgentError;
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};

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
}
