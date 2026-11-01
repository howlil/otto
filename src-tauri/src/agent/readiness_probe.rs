use tokio::sync::oneshot;

#[derive(Default)]
pub struct ReadinessProbeState {
    newest_id: u64,
    active: Option<(u64, oneshot::Sender<()>)>,
}

impl ReadinessProbeState {
    pub fn begin(&mut self, request_id: u64) -> Result<oneshot::Receiver<()>, String> {
        if request_id <= self.newest_id {
            return Err("Readiness request is no longer current.".into());
        }
        self.newest_id = request_id;
        let (cancel_tx, cancel_rx) = oneshot::channel();
        if let Some((_, previous)) = self.active.replace((request_id, cancel_tx)) {
            let _ = previous.send(());
        }
        Ok(cancel_rx)
    }

    pub fn cancel(&mut self, request_id: u64) {
        self.newest_id = self.newest_id.max(request_id);
        if self
            .active
            .as_ref()
            .is_some_and(|(active_id, _)| *active_id == request_id)
            && let Some((_, cancel)) = self.active.take()
        {
            let _ = cancel.send(());
        }
    }

    pub fn finish(&mut self, request_id: u64) {
        if self
            .active
            .as_ref()
            .is_some_and(|(active_id, _)| *active_id == request_id)
        {
            self.active.take();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::oneshot::error::TryRecvError;

    #[test]
    fn newest_probe_cancels_previous_without_canceling_newer_work() {
        let mut probes = ReadinessProbeState::default();
        let mut old = probes.begin(11).unwrap();
        let mut newest = probes.begin(12).unwrap();
        assert_eq!(old.try_recv(), Ok(()));
        probes.cancel(11);
        assert_eq!(newest.try_recv(), Err(TryRecvError::Empty));
        probes.cancel(12);
        assert_eq!(newest.try_recv(), Ok(()));
    }

    #[test]
    fn cancellation_before_registration_blocks_late_request() {
        let mut probes = ReadinessProbeState::default();
        probes.cancel(21);
        assert!(probes.begin(21).is_err());
        let mut current = probes.begin(22).unwrap();
        probes.finish(21);
        assert_eq!(current.try_recv(), Err(TryRecvError::Empty));
        probes.finish(22);
        assert_eq!(current.try_recv(), Err(TryRecvError::Closed));
    }
}
