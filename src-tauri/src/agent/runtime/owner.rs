use super::{
    capture::{DEFAULT_IMAGE_CAPTURE_PROMPT, DEFAULT_TEXT_CAPTURE_PROMPT, StagedCaptureArtifact},
    prompt::{AssistantGuidance, AssistantProfile, LearningMode},
    readiness_probe::ReadinessProbeState,
    recovery::RecoveryMarker,
    run::TurnRequest,
    turn_controls::FollowupQueueState,
};
use crate::agent::{
    AcceptedRun, CaptureSnapshot, CapturedImage, Control, ModelSelection, ProviderId, RunPhase,
    Snapshot,
    conversation::{ConversationOwner, HistoryStore},
    model::default_workspace_path,
};
use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex as StdMutex,
        atomic::{AtomicBool, AtomicU64},
    },
};
use tokio::sync::{Mutex, mpsc, oneshot, watch};

#[derive(Clone)]
pub struct AgentRuntime {
    pub(in crate::agent) updates: watch::Sender<Snapshot>,
    pub(in crate::agent) control: Arc<Mutex<Option<mpsc::Sender<Control>>>>,
    pub(in crate::agent) conversation: Arc<ConversationOwner>,
    pub(in crate::agent) selected_runtime: Arc<StdMutex<ModelSelection>>,
    pub(in crate::agent) guidance: Arc<StdMutex<AssistantGuidance>>,
    pub(in crate::agent) last_session_guidance: Arc<StdMutex<Option<AssistantGuidance>>>,
    pub(in crate::agent) staged_capture: Arc<StdMutex<Option<StagedCaptureArtifact>>>,
    pub(in crate::agent) followup_queue: Arc<StdMutex<FollowupQueueState>>,
    pub(in crate::agent) capture_auto_send: Arc<AtomicBool>,
    pub(in crate::agent) next_runtime_selection_id: Arc<AtomicU64>,
    pub(in crate::agent) readiness_probes: Arc<StdMutex<ReadinessProbeState>>,
    pub(in crate::agent) active_run_readiness: Arc<StdMutex<Option<oneshot::Sender<()>>>>,
    pub(in crate::agent) next_run_id: Arc<AtomicU64>,
    pub(in crate::agent) next_capture_id: Arc<AtomicU64>,
    pub(in crate::agent) recovery: Option<RecoveryMarker>,
    #[cfg(windows)]
    pub(in crate::agent) capture_in_flight: Arc<AtomicBool>,
}

impl AgentRuntime {
    pub fn new() -> Self {
        Self::with_recovery(None, Arc::new(HistoryStore::memory()))
    }

    #[cfg(test)]
    pub fn persistent(path: PathBuf) -> Self {
        Self::with_recovery(
            Some(RecoveryMarker::new(path)),
            Arc::new(HistoryStore::memory()),
        )
    }

    pub fn persistent_with_history(marker: PathBuf, history_path: PathBuf) -> Self {
        Self::with_recovery(
            Some(RecoveryMarker::new(marker)),
            Arc::new(HistoryStore::file(history_path)),
        )
    }

    fn with_recovery(recovery: Option<RecoveryMarker>, history: Arc<HistoryStore>) -> Self {
        let interrupted = recovery
            .as_ref()
            .is_some_and(RecoveryMarker::take_interrupted);
        let cwd = default_workspace_path().to_string_lossy().into_owned();
        let conversation_id = crate::agent::conversation::new_id();
        let (updates, _) = watch::channel(Snapshot {
            run_id: 0,
            seq: u64::from(interrupted),
            status: if interrupted {
                RunPhase::Failed
            } else {
                RunPhase::Idle
            },
            provider: ProviderId::default(),
            cwd,
            conversation_id: conversation_id.clone(),
            thread_id: None,
            model: None,
            thinking_effort: None,
            usage: None,
            rate_limits: Vec::new(),
            messages: Vec::new(),
            activity: Vec::new(),
            capture: CaptureSnapshot::default(),
            queued_followup: None,
            pending_permission: None,
            error: interrupted.then(|| {
                "Previous agent request may have been interrupted. No answer was restored. Ask again to start a new session.".into()
            }),
        });
        let conversation = Arc::new(ConversationOwner::new(history, conversation_id));
        Self {
            updates,
            control: Arc::new(Mutex::new(None)),
            conversation,
            selected_runtime: Arc::new(StdMutex::new(ModelSelection::default())),
            guidance: Arc::new(StdMutex::new(AssistantGuidance::default())),
            last_session_guidance: Arc::new(StdMutex::new(None)),
            staged_capture: Arc::new(StdMutex::new(None)),
            followup_queue: Arc::new(StdMutex::new(FollowupQueueState::default())),
            capture_auto_send: Arc::new(AtomicBool::new(false)),
            next_runtime_selection_id: Arc::new(AtomicU64::new(0)),
            readiness_probes: Arc::new(StdMutex::new(ReadinessProbeState::default())),
            active_run_readiness: Arc::new(StdMutex::new(None)),
            next_run_id: Arc::new(AtomicU64::new(0)),
            next_capture_id: Arc::new(AtomicU64::new(0)),
            recovery,
            #[cfg(windows)]
            capture_in_flight: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn snapshot(&self) -> Snapshot {
        self.updates.borrow().clone()
    }

    pub(crate) fn subscribe_updates(&self) -> watch::Receiver<Snapshot> {
        self.updates.subscribe()
    }

    pub fn set_guidance(
        &self,
        mode: Option<String>,
        profile: Option<AssistantProfile>,
    ) -> Result<(), String> {
        let mut current = self
            .guidance
            .lock()
            .map_err(|_| "Assistant preferences are unavailable.".to_string())?;
        if let Some(raw_mode) = mode {
            current.mode =
                LearningMode::parse(&raw_mode).ok_or("Unsupported learning mode.".to_string())?;
        }
        if let Some(next_profile) = profile {
            current.profile = next_profile.sanitized();
        }
        Ok(())
    }

    pub(crate) fn resolve_guidance(
        &self,
        mode: Option<String>,
        profile: Option<AssistantProfile>,
    ) -> Result<AssistantGuidance, String> {
        let mut current = self
            .guidance
            .lock()
            .map_err(|_| "Assistant preferences are unavailable.".to_string())?;
        if let Some(raw_mode) = mode {
            current.mode =
                LearningMode::parse(&raw_mode).ok_or("Unsupported learning mode.".to_string())?;
        }
        if let Some(next_profile) = profile {
            current.profile = next_profile.sanitized();
        }
        Ok(current.sanitized())
    }

    pub(crate) fn should_include_guidance(
        &self,
        guidance: &AssistantGuidance,
        provider_has_context: bool,
    ) -> bool {
        if !provider_has_context {
            return true;
        }
        let previous = self
            .last_session_guidance
            .lock()
            .ok()
            .and_then(|value| value.clone());
        previous.as_ref() != Some(guidance)
    }

    pub(crate) fn record_session_guidance(&self, guidance: &AssistantGuidance, ephemeral: bool) {
        if let Ok(mut slot) = self.last_session_guidance.lock() {
            *slot = (!ephemeral).then(|| guidance.clone());
        }
    }

    pub(crate) fn clear_session_guidance(&self) {
        if let Ok(mut slot) = self.last_session_guidance.lock() {
            *slot = None;
        }
    }

    #[cfg(test)]
    pub async fn ask(
        &self,
        text: String,
        provider: String,
        model: Option<String>,
        thinking_effort: Option<String>,
    ) -> Result<AcceptedRun, String> {
        self.ask_with_guidance(text, provider, model, thinking_effort, None, None)
            .await
    }

    pub async fn ask_with_guidance(
        &self,
        text: String,
        provider: String,
        model: Option<String>,
        thinking_effort: Option<String>,
        mode: Option<String>,
        profile: Option<AssistantProfile>,
    ) -> Result<AcceptedRun, String> {
        let guidance = self.resolve_guidance(mode, profile)?;
        let resolved_text = if text.trim().is_empty() {
            match self.peek_staged_capture_meta() {
                Some((_, true)) => DEFAULT_IMAGE_CAPTURE_PROMPT.to_owned(),
                Some((_, false)) => DEFAULT_TEXT_CAPTURE_PROMPT.to_owned(),
                None => text,
            }
        } else {
            text
        };
        self.ask_with_context(TurnRequest {
            text: resolved_text,
            cwd: default_workspace_path().to_string_lossy().into_owned(),
            provider,
            selection: ModelSelection {
                model,
                thinking_effort,
            },
            capture: None,
            selected_text: None,
            guidance,
            truncate_messages_to: None,
            consume_staged: true,
        })
        .await
    }

    pub(crate) async fn ask_with_selected_text(
        &self,
        text: String,
        cwd: String,
        provider: String,
        selection: ModelSelection,
        selected_text: String,
    ) -> Result<AcceptedRun, String> {
        let guidance = self.resolve_guidance(None, None)?;
        self.ask_with_context(TurnRequest {
            text,
            cwd,
            provider,
            selection,
            capture: None,
            selected_text: Some(selected_text),
            guidance,
            truncate_messages_to: None,
            consume_staged: false,
        })
        .await
    }

    pub(crate) async fn ask_with_capture(
        &self,
        text: String,
        cwd: String,
        provider: String,
        selection: ModelSelection,
        capture: Option<CapturedImage>,
    ) -> Result<AcceptedRun, String> {
        let guidance = self.resolve_guidance(None, None)?;
        self.ask_with_context(TurnRequest {
            text,
            cwd,
            provider,
            selection,
            capture,
            selected_text: None,
            guidance,
            truncate_messages_to: None,
            consume_staged: false,
        })
        .await
    }
}
