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
            let staged = state.capture.staged.take();
            state.capture = CaptureSnapshot {
                request_id,
                phase: "preparing".into(),
                error: None,
                staged,
            };
        });
        Ok((request_id, reservation))
    }

    #[cfg(windows)]
    pub(crate) async fn capture_hotkey<F>(
        &self,
        request_id: u64,
        _reservation: CaptureReservation,
        deadline: Duration,
        prompt: &'static str,
        capture: F,
    ) -> Result<(), String>
    where
        F: FnOnce() -> Result<CapturedImageOutcome, String> + Send + 'static,
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
        let auto_send = self.capture_auto_send();
        let selected = self.capture_runtime_options(&state);
        if auto_send {
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
        }
        mutate(&self.updates, |state| {
            if state.capture.request_id == request_id {
                state.capture.phase = "capturing".into();
            }
        });
        let reservation = Arc::new(_reservation);
        let image = match capture_with_deadline(&reservation, deadline, capture).await? {
            CapturedImageOutcome::Captured(image) => image,
            CapturedImageOutcome::Cancelled => {
                self.clear_cancelled_capture(request_id);
                return Ok(());
            }
        };
        if !auto_send {
            let source = if prompt.contains("screen area") {
                "region"
            } else if prompt.contains("scrolling") {
                "scrollingWindow"
            } else if prompt.contains("full screen") {
                "fullScreen"
            } else {
                "window"
            };
            self.stage_captured_image(Some(request_id), source, image);
            return Ok(());
        }
        mutate(&self.updates, |state| {
            if state.capture.request_id == request_id {
                state.capture.phase = "submitting".into();
            }
        });
        self.ask_with_capture(
            prompt.into(),
            state.cwd,
            state.provider.as_str().into(),
            selected,
            Some(image),
        )
        .await
        .map(|_| ())
    }

    #[cfg(windows)]
    pub(crate) async fn selected_text_hotkey<F>(
        &self,
        request_id: u64,
        _reservation: CaptureReservation,
        capture: F,
    ) -> Result<(), String>
    where
        F: FnOnce() -> Result<String, String> + Send + 'static,
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
        let auto_send = self.capture_auto_send();
        let selected = self.capture_runtime_options(&state);
        if auto_send {
            let ready = self
                .provider_readiness_for(
                    state.provider.as_str(),
                    Some(&state.cwd),
                    selected.model.as_deref(),
                )
                .await;
            if ready.status != "ready" {
                return Err(format!("{} {}", ready.message, ready.recovery));
            }
        }
        mutate(&self.updates, |state| {
            if state.capture.request_id == request_id {
                state.capture.phase = "capturing".into();
            }
        });
        let reservation = Arc::new(_reservation);
        let selected_text =
            capture_text_with_deadline(&reservation, Duration::from_secs(8), capture).await?;
        if !auto_send {
            self.stage_selected_text(Some(request_id), selected_text);
            return Ok(());
        }
        mutate(&self.updates, |state| {
            if state.capture.request_id == request_id {
                state.capture.phase = "submitting".into();
            }
        });
        self.ask_with_selected_text(
            "Answer the clearest question or task in the selected text.".into(),
            state.cwd,
            state.provider.as_str().into(),
            selected,
            selected_text,
        )
        .await
        .map(|_| ())
    }
}
