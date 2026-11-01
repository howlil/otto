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

    pub fn mark(&self, run_id: u64) {
        let Ok(_guard) = self.access.lock() else {
            return;
        };
        if let Some(parent) = self.path.parent()
            && fs::create_dir_all(parent).is_err()
        {
            return;
        }
        let _ = fs::write(&self.path, run_id.to_string());
    }

    pub fn clear_if(&self, run_id: u64) {
        let Ok(_guard) = self.access.lock() else {
            return;
        };
        if fs::read_to_string(&self.path)
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            == Some(run_id)
        {
            let _ = fs::remove_file(&self.path);
        }
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
        marker.mark(7);
        assert_eq!(fs::read_to_string(&marker.path).unwrap(), "7");
        assert!(marker.take_interrupted());
        assert!(!marker.take_interrupted());
    }

    #[test]
    fn late_terminal_event_cannot_clear_a_new_run() {
        let marker = marker();
        marker.mark(7);
        marker.mark(8);
        marker.clear_if(7);
        assert_eq!(fs::read_to_string(&marker.path).unwrap(), "8");
        marker.clear_if(8);
        assert!(!marker.path.exists());
    }
}
