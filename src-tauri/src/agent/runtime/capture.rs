use crate::agent::*;

impl AgentRuntime {
    #[cfg(windows)]
    pub fn capture_error(&self, reason: &str) {
        self.set_capture_error(None, reason);
    }

    #[cfg(windows)]
    pub(crate) fn capture_error_for(&self, request_id: u64, reason: &str) {
        self.set_capture_error(Some(request_id), reason);
    }

    #[cfg(windows)]
    #[cfg(windows)]
    pub(crate) fn set_capture_error(&self, request_id: Option<u64>, reason: &str) {
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
}
