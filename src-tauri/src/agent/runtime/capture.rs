use crate::agent::{providers::stage_base64_png, *};
use std::sync::atomic::Ordering;

pub(crate) const DEFAULT_IMAGE_CAPTURE_PROMPT: &str =
    "Explain what is shown in this image and help me understand or solve any question in it.";
pub(crate) const DEFAULT_TEXT_CAPTURE_PROMPT: &str =
    "Explain and answer the clearest question or task in the selected text.";
const MAX_TEXT_PREVIEW_CHARS: usize = 120;

pub(crate) enum StagedCapturePayload {
    Image(CapturedImage),
    SelectedText(String),
}

pub(crate) struct StagedCaptureArtifact {
    pub snapshot: StagedCaptureSnapshot,
    pub payload: StagedCapturePayload,
}

fn summarize_selected_text(text: &str) -> String {
    let mut collapsed = String::new();
    let mut last_space = true;
    for ch in text.chars() {
        if ch.is_whitespace() {
            if !last_space {
                collapsed.push(' ');
                last_space = true;
            }
        } else if !ch.is_control() {
            collapsed.push(ch);
            last_space = false;
        }
        if collapsed.chars().count() >= MAX_TEXT_PREVIEW_CHARS {
            break;
        }
    }
    let trimmed = collapsed.trim();
    if text.chars().count() > MAX_TEXT_PREVIEW_CHARS {
        format!("{trimmed}…")
    } else {
        trimmed.to_owned()
    }
}

pub(crate) fn visual_source_label(source: &str) -> &'static str {
    match source {
        "region" => "Area snip",
        "scrollingWindow" => "Scrolling capture",
        "fullScreen" => "Full screen",
        "clipboard" => "Pasted image",
        _ => "Window capture",
    }
}

impl AgentRuntime {
    pub fn set_capture_auto_send(&self, auto_send: bool) {
        self.capture_auto_send.store(auto_send, Ordering::SeqCst);
    }

    pub fn capture_auto_send(&self) -> bool {
        self.capture_auto_send.load(Ordering::SeqCst)
    }

    pub fn clear_staged_capture(&self) {
        if let Ok(mut slot) = self.staged_capture.lock() {
            *slot = None;
        }
        mutate(&self.updates, |state| {
            state.capture.staged = None;
        });
    }

    pub(crate) fn clear_staged_image_if_unsupported(&self, provider: ProviderId) {
        if provider.capture_unavailable_reason().is_none() {
            return;
        }
        let should_clear = self
            .staged_capture
            .lock()
            .ok()
            .and_then(|slot| {
                slot.as_ref()
                    .map(|item| matches!(item.payload, StagedCapturePayload::Image(_)))
            })
            .unwrap_or(false);
        if should_clear {
            self.clear_staged_capture();
        }
    }

    pub(crate) fn peek_staged_capture_meta(&self) -> Option<(u64, bool)> {
        self.staged_capture.lock().ok().and_then(|slot| {
            slot.as_ref().map(|item| {
                (
                    item.snapshot.id,
                    matches!(item.payload, StagedCapturePayload::Image(_)),
                )
            })
        })
    }

    pub(crate) fn peek_staged_selected_text(&self, id: u64) -> Option<String> {
        self.staged_capture.lock().ok().and_then(|slot| {
            slot.as_ref()
                .filter(|item| item.snapshot.id == id)
                .and_then(|item| match &item.payload {
                    StagedCapturePayload::SelectedText(text) => Some(text.clone()),
                    StagedCapturePayload::Image(_) => None,
                })
        })
    }

    pub(crate) fn consume_turn_capture(
        &self,
        capture: Option<CapturedImage>,
        staged_meta: Option<(u64, bool)>,
    ) -> Option<CapturedImage> {
        match (capture, staged_meta) {
            (Some(image), _) => Some(image),
            (None, Some((staged_id, _))) => {
                self.take_staged_capture_if(staged_id)
                    .and_then(|item| match item.payload {
                        StagedCapturePayload::Image(image) => Some(image),
                        StagedCapturePayload::SelectedText(_) => None,
                    })
            }
            (None, None) => None,
        }
    }

    pub(crate) fn take_staged_capture_if(&self, id: u64) -> Option<StagedCaptureArtifact> {
        let taken = self.staged_capture.lock().ok().and_then(|mut slot| {
            if slot.as_ref().is_some_and(|item| item.snapshot.id == id) {
                slot.take()
            } else {
                None
            }
        });
        if taken.is_some() {
            mutate(&self.updates, |state| {
                if state
                    .capture
                    .staged
                    .as_ref()
                    .is_some_and(|staged| staged.id == id)
                {
                    state.capture.staged = None;
                }
            });
        }
        taken
    }

    pub fn stage_image_base64(
        &self,
        png_base64: &str,
        label: Option<String>,
    ) -> Result<StagedCaptureSnapshot, String> {
        let current = self.snapshot();
        if matches!(
            current.status,
            RunPhase::Starting | RunPhase::Streaming | RunPhase::Stopping
        ) {
            return Err("Finish or Stop the current answer before attaching an image.".into());
        }
        if let Some(reason) = current.provider.capture_unavailable_reason() {
            return Err(reason.into());
        }
        let (image, width, height) = stage_base64_png(png_base64)?;
        let display_label = label
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("Pasted image")
            .chars()
            .take(48)
            .collect::<String>();
        let preview = format!("{width}×{height} PNG");
        Ok(self.install_staged_capture(
            None,
            "image",
            "clipboard",
            &display_label,
            preview,
            StagedCapturePayload::Image(image),
        ))
    }

    pub(crate) fn stage_captured_image(
        &self,
        request_id: Option<u64>,
        source: &str,
        image: CapturedImage,
    ) -> StagedCaptureSnapshot {
        let label = visual_source_label(source);
        self.install_staged_capture(
            request_id,
            "image",
            source,
            label,
            format!("{label} · PNG"),
            StagedCapturePayload::Image(image),
        )
    }

    pub(crate) fn stage_selected_text(
        &self,
        request_id: Option<u64>,
        text: String,
    ) -> StagedCaptureSnapshot {
        let preview = summarize_selected_text(&text);
        self.install_staged_capture(
            request_id,
            "selectedText",
            "selectedText",
            "Selected text",
            preview,
            StagedCapturePayload::SelectedText(text),
        )
    }

    fn install_staged_capture(
        &self,
        request_id: Option<u64>,
        kind: &str,
        source: &str,
        label: &str,
        preview: String,
        payload: StagedCapturePayload,
    ) -> StagedCaptureSnapshot {
        let id = self.next_capture_id.fetch_add(1, Ordering::Relaxed) + 1;
        let snapshot = StagedCaptureSnapshot {
            id,
            kind: kind.to_owned(),
            source: source.to_owned(),
            label: label.to_owned(),
            preview,
        };
        if let Ok(mut slot) = self.staged_capture.lock() {
            *slot = Some(StagedCaptureArtifact {
                snapshot: snapshot.clone(),
                payload,
            });
        }
        mutate(&self.updates, |state| {
            if request_id.is_none_or(|req| state.capture.request_id == req) {
                state.capture.phase = "idle".into();
                state.capture.error = None;
            }
            state.capture.staged = Some(snapshot.clone());
            if state
                .error
                .as_deref()
                .is_some_and(|err| err.starts_with("Capture: "))
            {
                state.error = None;
            }
        });
        snapshot
    }

    #[cfg(windows)]
    pub fn capture_error(&self, reason: &str) {
        self.set_capture_error(None, reason);
    }

    #[cfg(windows)]
    pub(crate) fn capture_error_for(&self, request_id: u64, reason: &str) {
        self.set_capture_error(Some(request_id), reason);
    }

    #[cfg(windows)]
    pub(crate) fn set_capture_error(&self, request_id: Option<u64>, reason: &str) {
        if reason == "Screen capture is already in progress." {
            return;
        }
        mutate(&self.updates, |s| {
            if request_id.is_some_and(|id| s.capture.request_id != id) {
                return;
            }
            if matches!(
                s.status,
                RunPhase::Starting | RunPhase::Streaming | RunPhase::Stopping
            ) {
                return;
            }
            s.capture.phase = "failed".into();
            s.capture.error = Some(reason.to_owned());
            if s.status != RunPhase::Failed
                || s.error
                    .as_deref()
                    .is_some_and(|error| error.starts_with("Capture: "))
                || s.error.is_none()
            {
                s.error = Some(format!("Capture: {reason}"));
            }
        });
    }

    #[cfg(windows)]
    pub(crate) fn clear_cancelled_capture(&self, request_id: u64) {
        mutate(&self.updates, |s| {
            if s.capture.request_id != request_id {
                return;
            }
            if matches!(
                s.status,
                RunPhase::Starting | RunPhase::Streaming | RunPhase::Stopping
            ) {
                return;
            }
            let staged = s.capture.staged.take();
            s.capture = CaptureSnapshot {
                staged,
                ..CaptureSnapshot::default()
            };
        });
    }

    #[cfg(windows)]
    pub fn clear_capture_error(&self) {
        mutate(&self.updates, |s| {
            if s.error
                .as_deref()
                .is_some_and(|error| error.starts_with("Capture: "))
            {
                let staged = s.capture.staged.take();
                s.capture = CaptureSnapshot {
                    staged,
                    ..CaptureSnapshot::default()
                };
                s.error = None;
            }
        });
    }
}
