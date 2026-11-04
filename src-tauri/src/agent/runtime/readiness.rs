use crate::agent::*;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tokio::sync::oneshot;

impl AgentRuntime {
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

    pub(crate) fn begin_run_readiness(&self) -> Result<oneshot::Receiver<()>, String> {
        let mut active = self
            .active_run_readiness
            .lock()
            .map_err(|_| "Readiness controller unavailable.".to_string())?;
        if active.is_some() {
            return Err("Another agent readiness check is already running.".into());
        }
        let (cancel, cancelled) = oneshot::channel();
        *active = Some(cancel);
        Ok(cancelled)
    }

    pub(crate) fn finish_run_readiness(&self) {
        if let Ok(mut active) = self.active_run_readiness.lock() {
            *active = None;
        }
    }

    pub(crate) fn cancel_run_readiness(&self) -> bool {
        let cancel = self
            .active_run_readiness
            .lock()
            .ok()
            .and_then(|mut active| active.take());
        if let Some(cancel) = cancel {
            let _ = cancel.send(());
            true
        } else {
            false
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

    #[cfg(windows)]
    pub(crate) fn begin_capture(&self) -> Result<(u64, CaptureReservation), String> {
        if matches!(
            self.snapshot().status,
            RunPhase::Starting | RunPhase::Streaming | RunPhase::Stopping
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
        if state.capture.request_id != request_id || state.capture.phase != "preparing" {
            return Err("Capture request is no longer current.".into());
        }
        if matches!(
            state.status,
            RunPhase::Starting | RunPhase::Streaming | RunPhase::Stopping
        ) {
            return Err("Finish or Stop the current answer before capturing.".into());
        }
        if let Some(reason) = state.provider.capture_unavailable_reason() {
            return Err(reason.into());
        }
        let selected = self.capture_runtime_options(&state);
        let ready = self
            .provider_readiness_for(
                state.provider.as_str(),
                Some(&state.cwd),
                selected.model.as_deref(),
            )
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
            state.provider.as_str().into(),
            selected,
            Some(image),
        ).await.map(|_| ())
    }
}
