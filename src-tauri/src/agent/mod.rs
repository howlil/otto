#[cfg(windows)]
pub(crate) mod capture_context;
mod conversation;
mod error;
mod events;
pub(crate) mod history;
#[cfg(test)]
pub(crate) mod measurements;
mod model;
mod policy;
mod providers;
mod readiness_probe;
mod recovery;
mod runtime;

pub use model::{
    AcceptedRun, CaptureSnapshot, CapturedImage, ChatMessage, Control, ModelOption,
    ProviderReadiness, RunPhase, Snapshot, UsageSnapshot,
};
pub(crate) use model::{
    CaptureReservation, MARKER_CLEAR_NOTICE, ModelSelection, capture_with_deadline,
    default_workspace_path, mutate, resolve_workspace_path,
};
pub use runtime::ProviderId;
use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex as StdMutex,
        atomic::{AtomicBool, AtomicU64},
    },
};
use tokio::sync::{Mutex, mpsc, oneshot, watch};

#[cfg(test)]
use runtime::run::{
    MAX_PROMPT_BYTES, contextual_prompt, persist_terminal_outcome, validate_prompt,
};
#[cfg(test)]
use runtime::selection::runtime_selection_still_current;

pub struct AgentRuntime {
    updates: watch::Sender<Snapshot>,
    control: Mutex<Option<mpsc::Sender<Control>>>,
    conversation: Arc<conversation::ConversationOwner>,
    selected_runtime: StdMutex<ModelSelection>,
    next_runtime_selection_id: AtomicU64,
    readiness_probes: StdMutex<readiness_probe::ReadinessProbeState>,
    active_run_readiness: StdMutex<Option<oneshot::Sender<()>>>,
    next_run_id: AtomicU64,
    subscriptions: StdMutex<Option<(u64, oneshot::Sender<()>)>>,
    next_subscription_id: AtomicU64,
    next_capture_id: AtomicU64,
    recovery: Option<recovery::RecoveryMarker>,
    #[cfg(windows)]
    capture_in_flight: Arc<AtomicBool>,
}

impl AgentRuntime {
    pub fn new() -> Self {
        Self::with_recovery(None, Arc::new(history::HistoryStore::memory()))
    }

    #[cfg(test)]
    pub fn persistent(path: PathBuf) -> Self {
        Self::with_recovery(
            Some(recovery::RecoveryMarker::new(path)),
            Arc::new(history::HistoryStore::memory()),
        )
    }

    pub fn persistent_with_history(marker: PathBuf, history_path: PathBuf) -> Self {
        Self::with_recovery(
            Some(recovery::RecoveryMarker::new(marker)),
            Arc::new(history::HistoryStore::file(history_path)),
        )
    }

    fn with_recovery(
        recovery: Option<recovery::RecoveryMarker>,
        history: Arc<history::HistoryStore>,
    ) -> Self {
        let interrupted = recovery
            .as_ref()
            .is_some_and(recovery::RecoveryMarker::take_interrupted);
        let cwd = default_workspace_path().to_string_lossy().into_owned();
        let conversation_id = history::new_id();
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
            messages: Vec::new(),
            capture: CaptureSnapshot::default(),
            error: interrupted.then(|| {
                "Previous agent request may have been interrupted. No answer was restored. Ask again to start a new session.".into()
            }),
        });
        let conversation = Arc::new(conversation::ConversationOwner::new(
            history,
            conversation_id,
        ));
        Self {
            updates,
            control: Mutex::new(None),
            conversation,
            selected_runtime: StdMutex::new(ModelSelection::default()),
            next_runtime_selection_id: AtomicU64::new(0),
            readiness_probes: StdMutex::new(readiness_probe::ReadinessProbeState::default()),
            active_run_readiness: StdMutex::new(None),
            next_run_id: AtomicU64::new(0),
            subscriptions: StdMutex::new(None),
            next_subscription_id: AtomicU64::new(0),
            next_capture_id: AtomicU64::new(0),
            recovery,
            #[cfg(windows)]
            capture_in_flight: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn snapshot(&self) -> Snapshot {
        self.updates.borrow().clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::Ordering;
    use std::time::Duration;
    use tokio::time::timeout;

    #[test]
    fn prompt_validation_trims_and_enforces_byte_limit() {
        assert_eq!(validate_prompt("  explain this  ").unwrap(), "explain this");
        assert!(validate_prompt("   ").is_err());
        assert!(validate_prompt(&"a".repeat(MAX_PROMPT_BYTES)).is_ok());
        assert!(validate_prompt(&"a".repeat(MAX_PROMPT_BYTES + 1)).is_err());
        assert!(validate_prompt(&"🙂".repeat(MAX_PROMPT_BYTES / 4 + 1)).is_err());
    }

    #[test]
    fn captured_image_removes_its_temporary_file_when_dropped() {
        let path = std::env::temp_dir().join(format!(
            "otto-capture-lifetime-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(&path, b"capture").unwrap();
        let image = CapturedImage::new(path.clone());
        assert!(path.is_file());
        drop(image);
        assert!(!path.exists());
    }

    #[test]
    fn persistent_runtime_reports_interrupted_startup_without_restoring_answer() {
        let marker_path = std::env::temp_dir().join(format!(
            "otto-runtime-recovery-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = AgentRuntime::persistent(marker_path.clone());
        runtime.recovery.as_ref().unwrap().mark(42).unwrap();
        drop(runtime);

        let restarted = AgentRuntime::persistent(marker_path.clone());
        let snapshot = restarted.snapshot();
        assert_eq!(snapshot.status, "failed");
        assert!(snapshot.messages.is_empty());
        assert!(snapshot.thread_id.is_none());
        assert!(snapshot.error.as_deref().unwrap().contains("interrupted"));
        assert!(!marker_path.exists());
    }

    #[tokio::test]
    async fn switching_completed_provider_keeps_conversation_and_closes_native_transport() {
        let root = std::env::temp_dir().join(format!(
            "otto-provider-switch-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let history_path = root.join("conversations.json");
        let runtime =
            AgentRuntime::persistent_with_history(root.join("marker"), history_path.clone());
        let (sender, mut receiver) = mpsc::channel(2);
        *runtime.control.lock().await = Some(sender);
        mutate(&runtime.updates, |state| {
            state.status = RunPhase::Completed;
            state.run_id = 7;
            state.thread_id = Some("native-codex-thread".into());
            state.model = Some("old-model".into());
            state.messages = vec![
                ChatMessage {
                    id: "7:user".into(),
                    role: "user".into(),
                    text: "Explain ownership".into(),
                },
                ChatMessage {
                    id: "7:assistant".into(),
                    role: "assistant".into(),
                    text: "Ownership controls lifetime.".into(),
                },
            ];
        });
        let before = runtime.snapshot();
        let worker = tokio::spawn(async move {
            let Some(Control::Close { claimed, finished }) = receiver.recv().await else {
                panic!("native transport must be closed before provider changes");
            };
            assert!(!claimed.swap(true, Ordering::SeqCst));
            finished.send(()).unwrap();
        });
        runtime.select_provider("pi".into()).await.unwrap();
        worker.await.unwrap();
        let after = runtime.snapshot();
        assert_eq!(after.conversation_id, before.conversation_id);
        assert_eq!(after.messages.len(), 2);
        assert_eq!(after.provider, ProviderId::Pi);
        assert!(after.thread_id.is_none());
        assert!(after.model.is_none());
        assert!(after.usage.is_none());
        assert!(after.run_id > before.run_id);
        assert!(runtime.control.lock().await.is_none());
        let saved = runtime
            .conversation
            .history
            .open(&after.conversation_id)
            .unwrap();
        assert_eq!(saved.provider, ProviderId::Pi);
        assert_eq!(saved.messages[1].text, "Ownership controls lifetime.");
        let raw = std::fs::read_to_string(history_path).unwrap();
        assert!(!raw.contains("native-codex-thread"));
        assert!(!raw.contains("cwd"));
        assert!(
            contextual_prompt(&after.messages, "What about borrowing?")
                .contains("Otto: Ownership controls lifetime.")
        );
        let restarted = AgentRuntime::persistent_with_history(
            root.join("marker2"),
            root.join("conversations.json"),
        );
        let reopened = restarted
            .history_open(&after.conversation_id)
            .await
            .unwrap();
        assert_eq!(reopened.provider, ProviderId::Pi);
        assert!(reopened.thread_id.is_none());
        assert_eq!(reopened.messages.len(), 2);
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn provider_switch_chain_keeps_conversation_and_rebuilds_bounded_context() {
        let root = std::env::temp_dir().join(format!(
            "otto-provider-chain-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let history_path = root.join("conversations.json");
        let runtime =
            AgentRuntime::persistent_with_history(root.join("marker"), history_path.clone());
        mutate(&runtime.updates, |state| {
            state.status = RunPhase::Completed;
            state.run_id = 7;
            state.thread_id = Some("native-codex-thread".into());
            state.model = Some("codex-model".into());
            state.messages = vec![
                ChatMessage {
                    id: "7:user".into(),
                    role: "user".into(),
                    text: "Explain ownership".into(),
                },
                ChatMessage {
                    id: "7:assistant".into(),
                    role: "assistant".into(),
                    text: "Ownership controls lifetime.".into(),
                },
            ];
        });
        let start = runtime.snapshot();
        runtime.select_provider("pi".into()).await.unwrap();
        let after_pi = runtime.snapshot();
        assert_eq!(after_pi.conversation_id, start.conversation_id);
        assert_eq!(after_pi.provider, ProviderId::Pi);
        assert!(after_pi.thread_id.is_none());

        mutate(&runtime.updates, |state| {
            state.status = RunPhase::Completed;
            state.run_id = 8;
            state.thread_id = Some("native-pi-thread".into());
            state.messages.push(ChatMessage {
                id: "8:user".into(),
                role: "user".into(),
                text: "What about borrowing?".into(),
            });
            state.messages.push(ChatMessage {
                id: "8:assistant".into(),
                role: "assistant".into(),
                text: "Borrowing never transfers ownership.".into(),
            });
        });
        runtime.select_provider("agy".into()).await.unwrap();
        let after_agy = runtime.snapshot();
        assert_eq!(after_agy.conversation_id, start.conversation_id);
        assert_eq!(after_agy.provider, ProviderId::Agy);
        assert_eq!(after_agy.messages.len(), 4);
        assert!(after_agy.thread_id.is_none());
        assert!(after_agy.model.is_none());
        assert!(after_agy.usage.is_none());
        let reconstructed = contextual_prompt(&after_agy.messages, "And moves?");
        assert!(reconstructed.contains("Otto: Ownership controls lifetime."));
        assert!(reconstructed.contains("Otto: Borrowing never transfers ownership."));
        assert!(reconstructed.contains("User: What about borrowing?"));
        let saved = runtime
            .conversation
            .history
            .open(&after_agy.conversation_id)
            .unwrap();
        assert_eq!(saved.provider, ProviderId::Agy);
        assert_eq!(saved.messages.len(), 4);
        let raw = std::fs::read_to_string(&history_path).unwrap();
        assert!(!raw.contains("native-codex-thread"));
        assert!(!raw.contains("native-pi-thread"));

        let restarted = AgentRuntime::persistent_with_history(
            root.join("marker2"),
            root.join("conversations.json"),
        );
        let reopened = restarted
            .history_open(&after_agy.conversation_id)
            .await
            .unwrap();
        assert_eq!(reopened.provider, ProviderId::Agy);
        assert!(reopened.thread_id.is_none());
        assert_eq!(reopened.messages.len(), 4);
        assert_eq!(
            reopened
                .messages
                .last()
                .map(|message| message.text.as_str()),
            Some("Borrowing never transfers ownership.")
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn switching_provider_rejects_active_turn_and_capture() {
        let runtime = AgentRuntime::new();
        for status in [RunPhase::Starting, RunPhase::Streaming, RunPhase::Stopping] {
            mutate(&runtime.updates, |state| state.status = status);
            assert!(runtime.select_provider("pi".into()).await.is_err());
            assert_eq!(runtime.snapshot().provider, ProviderId::Codex);
        }
        mutate(&runtime.updates, |state| {
            state.status = RunPhase::Completed;
            state.capture.phase = "preparing".into();
        });
        assert!(runtime.select_provider("pi".into()).await.is_err());
        assert_eq!(runtime.snapshot().provider, ProviderId::Codex);
    }

    #[tokio::test]
    async fn failed_provider_close_does_not_discard_current_session() {
        let runtime = AgentRuntime::new();
        let (sender, receiver) = mpsc::channel(2);
        *runtime.control.lock().await = Some(sender);
        mutate(&runtime.updates, |state| {
            state.status = RunPhase::Completed;
            state.thread_id = Some("still-owned".into());
        });
        let before = runtime.snapshot();
        let result = runtime
            .select_provider_with_timeout("pi".into(), Duration::from_millis(10))
            .await;
        assert!(result.is_err());
        let after = runtime.snapshot();
        assert_eq!(after.provider, before.provider);
        assert_eq!(after.conversation_id, before.conversation_id);
        assert_eq!(after.thread_id, before.thread_id);
        assert_eq!(after.run_id, before.run_id);
        drop(receiver);
    }

    #[tokio::test]
    async fn history_failure_after_close_clears_native_identity_without_changing_provider() {
        let root = std::env::temp_dir().join(format!(
            "otto-switch-save-failure-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let blocker = root.join("not-a-directory");
        std::fs::write(&blocker, b"blocked").unwrap();
        let runtime = AgentRuntime::persistent_with_history(
            root.join("marker"),
            blocker.join("conversations.json"),
        );
        let (sender, mut receiver) = mpsc::channel(2);
        *runtime.control.lock().await = Some(sender);
        mutate(&runtime.updates, |state| {
            state.status = RunPhase::Completed;
            state.thread_id = Some("native-session".into());
            state.messages.push(ChatMessage {
                id: "1:user".into(),
                role: "user".into(),
                text: "Original question".into(),
            });
        });
        let before = runtime.snapshot();
        let worker = tokio::spawn(async move {
            let Some(Control::Close { claimed, finished }) = receiver.recv().await else {
                panic!("close request expected");
            };
            assert!(!claimed.swap(true, Ordering::SeqCst));
            finished.send(()).unwrap();
        });
        assert!(runtime.select_provider("pi".into()).await.is_err());
        worker.await.unwrap();
        let after = runtime.snapshot();
        assert_eq!(after.provider, ProviderId::Codex);
        assert_eq!(after.conversation_id, before.conversation_id);
        assert_eq!(after.messages[0].text, "Original question");
        assert!(after.thread_id.is_none());
        assert!(runtime.control.lock().await.is_none());
        assert!(
            after
                .error
                .as_deref()
                .unwrap()
                .contains("could not be saved")
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn capture_started_during_close_prevents_provider_switch() {
        let runtime = AgentRuntime::new();
        let (sender, mut receiver) = mpsc::channel(2);
        *runtime.control.lock().await = Some(sender);
        mutate(&runtime.updates, |state| {
            state.status = RunPhase::Completed;
            state.thread_id = Some("old-session".into());
        });
        let (received, acknowledged) = oneshot::channel();
        let (release, proceed) = oneshot::channel();
        let worker = tokio::spawn(async move {
            let Some(Control::Close { claimed, finished }) = receiver.recv().await else {
                panic!("close request expected");
            };
            assert!(!claimed.swap(true, Ordering::SeqCst));
            received.send(()).unwrap();
            proceed.await.unwrap();
            finished.send(()).unwrap();
        });
        let switch = runtime.select_provider("pi".into());
        tokio::pin!(switch);
        tokio::select! {
            result = &mut switch => panic!("switch completed before close: {result:?}"),
            result = acknowledged => assert!(result.is_ok()),
        }
        mutate(&runtime.updates, |state| {
            state.capture.request_id = 1;
            state.capture.phase = "preparing".into();
        });
        release.send(()).unwrap();
        assert!(switch.await.is_err());
        worker.await.unwrap();
        let state = runtime.snapshot();
        assert_eq!(state.provider, ProviderId::Codex);
        assert!(state.thread_id.is_none());
        assert_eq!(state.capture.phase, "preparing");
    }

    #[test]
    fn stale_terminal_observer_does_not_overwrite_new_provider_history() {
        let root = std::env::temp_dir().join(format!(
            "otto-stale-switch-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = AgentRuntime::persistent_with_history(
            root.join("marker"),
            root.join("conversations.json"),
        );
        runtime.recovery.as_ref().unwrap().mark(3).unwrap();
        let mut old = runtime.snapshot();
        old.run_id = 3;
        old.status = RunPhase::Completed;
        old.messages = vec![ChatMessage {
            id: "3:user".into(),
            role: "user".into(),
            text: "old".into(),
        }];
        mutate(&runtime.updates, |state| state.run_id = 4);
        persist_terminal_outcome(
            &runtime.conversation,
            runtime.recovery.as_ref().unwrap(),
            &runtime.updates,
            &old,
        );
        assert!(runtime.conversation.history.list().unwrap().is_empty());
        assert_eq!(std::fs::read_to_string(root.join("marker")).unwrap(), "3");
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn completed_agy_followup_uses_owned_runtime_without_reprobing_cli() {
        let runtime = AgentRuntime::new();
        runtime.select_provider("agy".into()).await.unwrap();
        let cwd = std::fs::canonicalize(default_workspace_path()).unwrap();
        mutate(&runtime.updates, |state| {
            state.status = "completed".into();
            state.thread_id = Some("agy-conversation".into());
            state.cwd = cwd.to_string_lossy().into_owned();
        });
        let (sender, mut receiver) = mpsc::channel(2);
        *runtime.control.lock().await = Some(sender);
        runtime
            .ask("continue the explanation".into(), "agy".into(), None, None)
            .await
            .expect("a completed Agy conversation must not require another CLI probe");
        assert!(matches!(receiver.try_recv(), Ok(Control::Ask { .. })));
        assert_eq!(runtime.snapshot().status, "starting");
    }

    #[test]
    fn typed_run_contract_preserves_ipc_wire_values() {
        assert_eq!(serde_json::to_string(&ProviderId::Pi).unwrap(), "\"pi\"");
        assert_eq!(
            serde_json::to_string(&AcceptedRun { run_id: 42 }).unwrap(),
            "{\"runId\":42}"
        );
    }

    #[test]
    fn public_snapshot_excludes_workspace_and_tool_control_fields() {
        let runtime = AgentRuntime::new();
        let value = serde_json::to_value(runtime.snapshot()).unwrap();
        let object = value.as_object().unwrap();
        assert!(!object.contains_key("mode"));
        assert!(!object.contains_key("cwd"));
    }

    #[tokio::test]
    async fn opened_history_becomes_the_active_conversation_in_snapshot() {
        let root = std::env::temp_dir().join(format!(
            "otto-open-history-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = AgentRuntime::persistent_with_history(
            root.join("marker"),
            root.join("conversations.json"),
        );
        runtime.persist_prompt(7, "First conversation").unwrap();
        let original = runtime.snapshot().conversation_id;
        assert!(!original.is_empty());

        let opened = runtime.conversation.history.list().unwrap();
        assert_eq!(opened.len(), 1);
        let snapshot = runtime
            .history_open(&opened[0].id)
            .await
            .expect("saved conversation opens");
        assert_eq!(snapshot.conversation_id, opened[0].id);
        assert_eq!(snapshot.messages.len(), 1);
        assert_eq!(snapshot.messages[0].text, "First conversation");
        assert_eq!(snapshot.provider, "codex");
        assert_eq!(runtime.snapshot().conversation_id, opened[0].id);
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn reopening_current_history_uses_latest_persisted_transcript() {
        let root = std::env::temp_dir().join(format!(
            "otto-history-refresh-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = AgentRuntime::persistent_with_history(
            root.join("marker"),
            root.join("conversations.json"),
        );
        runtime.persist_prompt(7, "Original question").unwrap();
        let id = runtime.snapshot().conversation_id;
        assert_eq!(
            runtime
                .conversation
                .history
                .open(&id)
                .unwrap()
                .messages
                .len(),
            1
        );
        mutate(&runtime.updates, |state| {
            state.run_id = 7;
            state.status = RunPhase::Completed;
            state.messages = vec![
                ChatMessage {
                    id: "7:user".into(),
                    role: "user".into(),
                    text: "Original question".into(),
                },
                ChatMessage {
                    id: "7:assistant".into(),
                    role: "assistant".into(),
                    text: "Latest completed answer".into(),
                },
            ];
        });

        let reopened = runtime.history_open(&id).await.unwrap();
        assert_eq!(reopened.conversation_id, id);
        assert_eq!(reopened.messages.len(), 2);
        assert_eq!(reopened.messages[1].text, "Latest completed answer");
        assert_eq!(
            runtime.conversation.history.open(&id).unwrap().messages[1].text,
            "Latest completed answer"
        );
        assert!(reopened.thread_id.is_none());
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn corrupt_history_open_cannot_clear_the_active_transcript() {
        let root = std::env::temp_dir().join(format!(
            "otto-history-corrupt-open-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = AgentRuntime::persistent_with_history(
            root.join("marker"),
            root.join("conversations.json"),
        );
        mutate(&runtime.updates, |state| {
            state.run_id = 6;
            state.status = RunPhase::Completed;
            state.messages = vec![
                ChatMessage {
                    id: "6:user".into(),
                    role: "user".into(),
                    text: "Keep this question".into(),
                },
                ChatMessage {
                    id: "6:assistant".into(),
                    role: "assistant".into(),
                    text: "Keep this answer".into(),
                },
            ];
        });
        runtime.persist_current_snapshot(false).unwrap();
        let before = runtime.snapshot();
        std::fs::write(root.join("conversations.json"), b"not valid JSON").unwrap();

        assert!(runtime.history_open(&before.conversation_id).await.is_err());
        let after = runtime.snapshot();
        assert_eq!(after.conversation_id, before.conversation_id);
        assert_eq!(after.run_id, before.run_id);
        assert_eq!(after.messages.len(), before.messages.len());
        assert_eq!(after.messages[1].text, "Keep this answer");
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn history_removal_during_native_close_keeps_prevalidated_transcript() {
        let root = std::env::temp_dir().join(format!(
            "otto-restore-file-race-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = Arc::new(AgentRuntime::persistent_with_history(
            root.join("marker"),
            root.join("conversations.json"),
        ));
        runtime
            .conversation
            .history
            .upsert(history::ConversationRecord {
                id: "saved".into(),
                title: "Saved".into(),
                provider: ProviderId::Codex,
                model: None,
                thinking_effort: None,
                messages: vec![ChatMessage {
                    id: "1:user".into(),
                    role: "user".into(),
                    text: "Keep the saved question".into(),
                }],
                created_at: 1,
                updated_at: 1,
                interrupted: false,
            })
            .unwrap();
        let (sender, mut receiver) = mpsc::channel(2);
        *runtime.control.lock().await = Some(sender);
        let opening = {
            let runtime = Arc::clone(&runtime);
            tokio::spawn(async move { runtime.history_open("saved").await })
        };
        let request = timeout(Duration::from_secs(5), receiver.recv())
            .await
            .unwrap()
            .unwrap();
        let Control::Close { finished, .. } = request else {
            panic!("restoring history must close the native session");
        };
        std::fs::remove_file(root.join("conversations.json")).unwrap();
        finished.send(()).unwrap();
        let restored = timeout(Duration::from_secs(5), opening)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(restored.conversation_id, "saved");
        assert_eq!(restored.messages[0].text, "Keep the saved question");
        assert_eq!(runtime.snapshot().conversation_id, "saved");
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn new_session_clears_provider_selection_and_usage() {
        let runtime = AgentRuntime::new();
        mutate(&runtime.updates, |state| {
            state.status = RunPhase::Completed;
            state.model = Some("prior-model".into());
            state.thinking_effort = Some("high".into());
            state.usage = Some(UsageSnapshot {
                context_tokens: Some(200),
                session_tokens: 100,
                input_tokens: 80,
                cached_input_tokens: 0,
                output_tokens: 20,
                reasoning_output_tokens: None,
                model_context_window: Some(8_000),
            });
        });
        runtime.new_session().await.unwrap();
        let reset = runtime.snapshot();
        assert_eq!(reset.status, RunPhase::Idle);
        assert!(reset.model.is_none());
        assert!(reset.thinking_effort.is_none());
        assert!(reset.usage.is_none());
    }

    #[tokio::test]
    async fn new_session_rotates_snapshot_conversation_id_and_keeps_the_old_record() {
        let root = std::env::temp_dir().join(format!(
            "otto-rotate-history-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = AgentRuntime::persistent_with_history(
            root.join("marker"),
            root.join("conversations.json"),
        );
        runtime.persist_prompt(9, "Previous chat").unwrap();
        let previous = runtime.snapshot().conversation_id;

        runtime
            .new_session()
            .await
            .expect("no active run blocks rotation");

        let snapshot = runtime.snapshot();
        assert_ne!(snapshot.conversation_id, previous);
        assert!(!snapshot.conversation_id.is_empty());
        assert_eq!(snapshot.messages.len(), 0);
        let list = runtime.conversation.history.list().unwrap();
        assert!(list.iter().any(|summary| summary.id == previous));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn persistent_history_stores_chat_text_without_runtime_identifiers() {
        let root = std::env::temp_dir().join(format!(
            "otto-runtime-history-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let history_path = root.join("conversations.json");
        let runtime =
            AgentRuntime::persistent_with_history(root.join("marker"), history_path.clone());
        mutate(&runtime.updates, |state| state.run_id = 1);
        runtime.persist_prompt(1, "Explain ownership").unwrap();
        let id = runtime.conversation.id.lock().unwrap().clone();
        let record = runtime.conversation.history.open(&id).unwrap();
        assert_eq!(record.messages[0].text, "Explain ownership");
        assert_eq!(runtime.snapshot().messages[0].text, "Explain ownership");
        let raw = std::fs::read_to_string(history_path).unwrap();
        assert!(!raw.contains("cwd"));
        assert!(!raw.contains("threadId"));
        let _ = std::fs::remove_dir_all(root);
    }

    fn terminal_snapshot(status: RunPhase) -> Snapshot {
        Snapshot {
            run_id: 3,
            seq: 9,
            status,
            provider: ProviderId::Codex,
            cwd: String::new(),
            conversation_id: "kept".into(),
            thread_id: None,
            model: None,
            thinking_effort: None,
            usage: None,
            messages: vec![ChatMessage {
                id: "3:user".into(),
                role: "user".into(),
                text: "Explain ownership".into(),
            }],
            capture: CaptureSnapshot::default(),
            error: None,
        }
    }

    #[test]
    fn terminal_history_write_failure_keeps_marker_and_reports_a_notice() {
        let root = std::env::temp_dir().join(format!(
            "otto-terminal-failure-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let blocker = root.join("blocker");
        fs::write(&blocker, b"not a directory").unwrap();
        let runtime = AgentRuntime::persistent_with_history(
            root.join("marker"),
            blocker.join("conversations.json"),
        );
        runtime.recovery.as_ref().unwrap().mark(3).unwrap();
        mutate(&runtime.updates, |state| state.run_id = 3);

        persist_terminal_outcome(
            &runtime.conversation,
            runtime.recovery.as_ref().unwrap(),
            &runtime.updates,
            &Snapshot {
                conversation_id: runtime.snapshot().conversation_id,
                ..terminal_snapshot(RunPhase::Failed)
            },
        );

        let observed = runtime.updates.borrow().clone();
        assert!(
            observed
                .error
                .as_deref()
                .unwrap()
                .contains("Conversation history could not be saved")
        );
        assert_eq!(
            fs::read_to_string(root.join("marker")).unwrap(),
            "3",
            "marker must survive so restart reports interrupted instead of a fabricated completion"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn terminal_history_write_success_clears_marker_without_false_completion_notice() {
        let root = std::env::temp_dir().join(format!(
            "otto-terminal-success-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = AgentRuntime::persistent_with_history(
            root.join("marker"),
            root.join("conversations.json"),
        );
        runtime.recovery.as_ref().unwrap().mark(3).unwrap();
        mutate(&runtime.updates, |state| state.run_id = 3);

        persist_terminal_outcome(
            &runtime.conversation,
            runtime.recovery.as_ref().unwrap(),
            &runtime.updates,
            &Snapshot {
                conversation_id: runtime.snapshot().conversation_id,
                ..terminal_snapshot(RunPhase::Failed)
            },
        );

        assert!(runtime.snapshot().error.is_none());
        assert!(!root.join("marker").exists());
        let id = runtime.conversation.id.lock().unwrap().clone();
        assert_eq!(
            runtime.conversation.history.open(&id).unwrap().messages[0].text,
            "Explain ownership"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn contextual_prompt_reconstructs_local_transcript_for_a_new_provider() {
        let prompt = contextual_prompt(
            &[
                ChatMessage {
                    id: "1:user".into(),
                    role: "user".into(),
                    text: "What is ownership?".into(),
                },
                ChatMessage {
                    id: "1:assistant".into(),
                    role: "assistant".into(),
                    text: "Ownership controls cleanup.".into(),
                },
            ],
            "How does borrowing relate?",
        );
        assert!(prompt.contains("User: What is ownership?"));
        assert!(prompt.contains("Otto: Ownership controls cleanup."));
        assert!(prompt.ends_with("New user question:\nHow does borrowing relate?"));
    }

    #[test]
    fn reconstructed_context_keeps_newest_messages_within_byte_budget() {
        let messages = vec![
            ChatMessage {
                id: "1:user".into(),
                role: "user".into(),
                text: "ancient".repeat(10_000),
            },
            ChatMessage {
                id: "2:user".into(),
                role: "user".into(),
                text: "Latest question".into(),
            },
            ChatMessage {
                id: "2:assistant".into(),
                role: "assistant".into(),
                text: "Latest answer".into(),
            },
        ];

        let prompt = contextual_prompt(&messages, "Follow-up");
        assert!(prompt.contains("User: Latest question"));
        assert!(prompt.contains("Otto: Latest answer"));
        assert!(!prompt.contains("ancient"));
        assert!(prompt.find("Latest question").unwrap() < prompt.find("Latest answer").unwrap());
        assert!(prompt.len() <= 48_000);
        assert!(prompt.ends_with("New user question:\nFollow-up"));
    }

    #[tokio::test]
    async fn opening_history_restores_transcript_without_provider_thread_identity() {
        let root = std::env::temp_dir().join(format!(
            "otto-history-open-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = AgentRuntime::persistent_with_history(
            root.join("marker"),
            root.join("conversations.json"),
        );
        runtime
            .conversation
            .history
            .upsert(history::ConversationRecord {
                id: "saved".into(),
                title: "Saved chat".into(),
                provider: ProviderId::Codex,
                model: Some("model".into()),
                thinking_effort: Some("high".into()),
                messages: vec![
                    ChatMessage {
                        id: "1:user".into(),
                        role: "user".into(),
                        text: "Explain ownership".into(),
                    },
                    ChatMessage {
                        id: "1:assistant".into(),
                        role: "assistant".into(),
                        text: "Ownership manages resource lifetime.".into(),
                    },
                ],
                created_at: 1,
                updated_at: 2,
                interrupted: false,
            })
            .unwrap();
        mutate(&runtime.updates, |state| {
            state.usage = Some(UsageSnapshot {
                context_tokens: None,
                session_tokens: 50,
                input_tokens: 25,
                cached_input_tokens: 0,
                output_tokens: 25,
                reasoning_output_tokens: None,
                model_context_window: None,
            });
        });
        let snapshot = runtime.history_open("saved").await.unwrap();
        assert_eq!(snapshot.status, RunPhase::Completed);
        assert!(snapshot.usage.is_none());
        assert_eq!(snapshot.model.as_deref(), Some("model"));
        assert_eq!(snapshot.thinking_effort.as_deref(), Some("high"));
        assert_eq!(snapshot.messages.len(), 2);
        assert!(snapshot.thread_id.is_none());
        assert_eq!(snapshot.provider, ProviderId::Codex);
        assert_eq!(runtime.conversation.id.lock().unwrap().as_str(), "saved");
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn restored_pi_history_uses_saved_model_for_capture_selection() {
        let root = std::env::temp_dir().join(format!(
            "otto-pi-history-options-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = AgentRuntime::persistent_with_history(
            root.join("marker"),
            root.join("conversations.json"),
        );
        runtime
            .conversation
            .history
            .upsert(history::ConversationRecord {
                id: "saved-pi".into(),
                title: "Pi history".into(),
                provider: ProviderId::Pi,
                model: Some("saved-model".into()),
                thinking_effort: Some("high".into()),
                messages: vec![ChatMessage {
                    id: "1:user".into(),
                    role: "user".into(),
                    text: "Explain the screenshot".into(),
                }],
                created_at: 1,
                updated_at: 1,
                interrupted: false,
            })
            .unwrap();

        let reopened = runtime.history_open("saved-pi").await.unwrap();
        assert_eq!(reopened.provider, ProviderId::Pi);
        assert!(reopened.thread_id.is_none());
        let capture = runtime.capture_runtime_options(&reopened);
        assert_eq!(capture.model.as_deref(), Some("saved-model"));
        assert_eq!(capture.thinking_effort.as_deref(), Some("high"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn live_sender_followup_keeps_provider_thread_identity() {
        let runtime = AgentRuntime::new();
        let cwd = std::fs::canonicalize(default_workspace_path()).unwrap();
        let (sender, _receiver) = mpsc::channel(4);
        *runtime.control.lock().await = Some(sender);
        mutate(&runtime.updates, |state| {
            state.status = "completed".into();
            state.thread_id = Some("provider-session".into());
            state.cwd = cwd.to_string_lossy().into_owned();
        });
        let _outcome = runtime
            .ask(
                "continue the explanation".into(),
                "codex".into(),
                None,
                None,
            )
            .await;
        assert!(
            runtime.snapshot().thread_id.is_some(),
            "a follow-up over a live provider transport must keep its session identity"
        );
    }

    #[test]
    fn long_transcripts_persist_the_newest_bounded_window() {
        let runtime = AgentRuntime::new();
        mutate(&runtime.updates, |state| {
            for index in 0..30 {
                state.messages.push(ChatMessage {
                    id: format!(
                        "{index}:{}",
                        if index % 2 == 0 { "user" } else { "assistant" }
                    ),
                    role: (if index % 2 == 0 { "user" } else { "assistant" }).into(),
                    text: format!("message {index}"),
                });
            }
        });
        let record = history::record_from_snapshot("long-conversation", &runtime.snapshot(), false)
            .expect("a long transcript must produce a record");
        assert_eq!(record.messages.len(), 24);
        assert_eq!(record.messages.first().unwrap().text, "message 6");
        runtime
            .conversation
            .history
            .upsert(record)
            .expect("a bounded record must persist");
    }

    #[tokio::test]
    async fn active_history_deletion_resets_without_resurrecting() {
        let root = std::env::temp_dir().join(format!(
            "otto-delete-active-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = AgentRuntime::persistent_with_history(
            root.join("marker"),
            root.join("conversations.json"),
        );
        runtime.persist_prompt(7, "Original chat").unwrap();
        let deleted = runtime.snapshot().conversation_id;
        assert!(runtime.conversation.history.open(&deleted).is_ok());

        runtime.history_delete(&deleted).await.unwrap();

        let after = runtime.snapshot();
        assert_ne!(after.conversation_id, deleted);
        assert_eq!(
            after.conversation_id,
            *runtime.conversation.id.lock().unwrap()
        );
        assert_eq!(after.status, RunPhase::Idle);
        assert!(after.messages.is_empty());
        assert!(after.thread_id.is_none());
        assert!(runtime.conversation.history.open(&deleted).is_err());

        runtime.persist_prompt(8, "Fresh chat").unwrap();
        assert!(runtime.conversation.history.open(&deleted).is_err());
        let items = runtime.conversation.history.list().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, after.conversation_id);
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn delete_all_history_resets_active_session_and_removes_every_record() {
        let root = std::env::temp_dir().join(format!(
            "otto-delete-all-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = AgentRuntime::persistent_with_history(
            root.join("marker"),
            root.join("conversations.json"),
        );
        runtime.persist_prompt(7, "Original chat").unwrap();
        let active = runtime.snapshot().conversation_id;
        let mut extra = runtime.conversation.history.open(&active).unwrap();
        extra.id = "other-chat".into();
        runtime.conversation.history.upsert(extra).unwrap();

        runtime.history_delete_all().await.unwrap();

        let after = runtime.snapshot();
        assert_ne!(after.conversation_id, active);
        assert_eq!(after.status, RunPhase::Idle);
        assert!(after.messages.is_empty());
        assert!(after.thread_id.is_none());
        assert!(runtime.conversation.history.list().unwrap().is_empty());
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn failed_active_history_delete_preserves_chat_after_native_close() {
        let root = std::env::temp_dir().join(format!(
            "otto-delete-write-failure-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = Arc::new(AgentRuntime::persistent_with_history(
            root.join("marker"),
            root.join("conversations.json"),
        ));
        mutate(&runtime.updates, |state| {
            state.status = RunPhase::Completed;
            state.run_id = 9;
            state.thread_id = Some("native-thread".into());
            state.messages = vec![
                ChatMessage {
                    id: "9:user".into(),
                    role: "user".into(),
                    text: "Keep question".into(),
                },
                ChatMessage {
                    id: "9:assistant".into(),
                    role: "assistant".into(),
                    text: "Keep answer".into(),
                },
            ];
        });
        runtime.persist_current_snapshot(false).unwrap();
        let before = runtime.snapshot();
        let (sender, mut receiver) = mpsc::channel(2);
        *runtime.control.lock().await = Some(sender);

        let deleting = {
            let runtime = Arc::clone(&runtime);
            let id = before.conversation_id.clone();
            tokio::spawn(async move { runtime.history_delete(&id).await })
        };
        let request = timeout(Duration::from_secs(5), receiver.recv())
            .await
            .unwrap()
            .unwrap();
        let Control::Close { finished, .. } = request else {
            panic!("active delete must close the native session");
        };
        std::fs::write(root.join("conversations.json"), b"not valid JSON").unwrap();
        finished.send(()).unwrap();

        let outcome = timeout(Duration::from_secs(5), deleting)
            .await
            .unwrap()
            .unwrap();
        assert!(outcome.is_err());
        let after = runtime.snapshot();
        assert_eq!(after.conversation_id, before.conversation_id);
        assert_eq!(after.messages.len(), before.messages.len());
        assert_eq!(after.messages[1].text, "Keep answer");
        assert!(after.thread_id.is_none());
        assert_eq!(after.status, RunPhase::Completed);
        assert!(runtime.control.lock().await.is_none());
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn deleting_missing_active_history_does_not_reset_current_conversation() {
        let root = std::env::temp_dir().join(format!(
            "otto-delete-missing-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = AgentRuntime::persistent_with_history(
            root.join("marker"),
            root.join("conversations.json"),
        );
        runtime
            .persist_prompt(5, "Keep active conversation")
            .unwrap();
        let before = runtime.snapshot();
        let missing = "not-a-saved-conversation";
        assert!(runtime.history_delete(missing).await.is_err());
        let after = runtime.snapshot();
        assert_eq!(after.conversation_id, before.conversation_id);
        assert_eq!(after.run_id, before.run_id);
        assert_eq!(
            runtime.conversation.id.lock().unwrap().as_str(),
            before.conversation_id
        );
        assert!(
            runtime
                .conversation
                .history
                .open(&before.conversation_id)
                .is_ok()
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn queued_delete_cannot_interleave_with_history_restore() {
        let root = std::env::temp_dir().join(format!(
            "otto-history-serialized-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = Arc::new(AgentRuntime::persistent_with_history(
            root.join("marker"),
            root.join("conversations.json"),
        ));
        runtime
            .conversation
            .history
            .upsert(history::ConversationRecord {
                id: "saved".into(),
                title: "Saved chat".into(),
                provider: ProviderId::Codex,
                model: None,
                thinking_effort: None,
                messages: vec![ChatMessage {
                    id: "1:user".into(),
                    role: "user".into(),
                    text: "Saved question".into(),
                }],
                created_at: 1,
                updated_at: 1,
                interrupted: false,
            })
            .unwrap();
        let (sender, mut receiver) = mpsc::channel(2);
        *runtime.control.lock().await = Some(sender);

        let opening = {
            let runtime = Arc::clone(&runtime);
            tokio::spawn(async move { runtime.history_open("saved").await })
        };
        let requested = timeout(Duration::from_secs(5), receiver.recv())
            .await
            .unwrap()
            .unwrap();
        let Control::Close { finished, .. } = requested else {
            panic!("opening history must close the native session");
        };
        let deleting = {
            let runtime = Arc::clone(&runtime);
            tokio::spawn(async move { runtime.history_delete("saved").await })
        };
        tokio::task::yield_now().await;
        assert!(runtime.control.try_lock().is_err());
        finished.send(()).unwrap();

        let opened = timeout(Duration::from_secs(5), opening)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(opened.conversation_id, "saved");
        timeout(Duration::from_secs(5), deleting)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_ne!(runtime.snapshot().conversation_id, "saved");
        assert!(runtime.conversation.history.open("saved").is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn active_history_deletion_rejects_running_turn() {
        let root = std::env::temp_dir().join(format!(
            "otto-delete-running-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = AgentRuntime::persistent_with_history(
            root.join("marker"),
            root.join("conversations.json"),
        );
        runtime.persist_prompt(7, "Still running").unwrap();
        let id = runtime.snapshot().conversation_id;
        mutate(&runtime.updates, |state| {
            state.run_id = 7;
            state.status = RunPhase::Streaming;
        });
        assert!(runtime.history_delete(&id).await.is_err());
        assert_eq!(runtime.snapshot().conversation_id, id);
        assert_eq!(
            runtime.conversation.history.open(&id).unwrap().messages[0].text,
            "Still running"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn terminal_observer_refuses_different_conversation_with_same_run_id() {
        let root = std::env::temp_dir().join(format!(
            "otto-stale-conversation-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = AgentRuntime::persistent_with_history(
            root.join("marker"),
            root.join("conversations.json"),
        );
        runtime.recovery.as_ref().unwrap().mark(3).unwrap();
        mutate(&runtime.updates, |state| state.run_id = 3);
        let stale = terminal_snapshot(RunPhase::Completed);

        persist_terminal_outcome(
            &runtime.conversation,
            runtime.recovery.as_ref().unwrap(),
            &runtime.updates,
            &stale,
        );
        assert!(runtime.conversation.history.list().unwrap().is_empty());
        assert_eq!(fs::read_to_string(root.join("marker")).unwrap(), "3");
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn failed_recovery_marker_does_not_reserve_readiness() {
        let parent = std::env::temp_dir().join(format!(
            "otto-recovery-runtime-file-parent-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(&parent, b"not a directory").unwrap();
        let runtime = AgentRuntime::persistent(parent.join("marker"));

        assert!(
            runtime
                .ask("explain this".into(), "codex".into(), None, None,)
                .await
                .is_err()
        );
        assert_eq!(runtime.snapshot().status, "idle");
        assert!(runtime.active_run_readiness.lock().unwrap().is_none());
        std::fs::remove_file(parent).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn selected_pi_runtime_is_independent_of_previous_answer() {
        let runtime = AgentRuntime::new();
        mutate(&runtime.updates, |state| {
            state.provider = "pi".into();
            state.model = Some("netra/text-only".into());
            state.thinking_effort = Some("off".into());
        });
        *runtime.selected_runtime.lock().unwrap() = ModelSelection {
            model: Some("opencode-go/vision".into()),
            thinking_effort: Some("high".into()),
        };
        let state = runtime.snapshot();
        let chosen = runtime.capture_runtime_options(&state);
        assert_eq!(chosen.model.as_deref(), Some("opencode-go/vision"));
        assert_eq!(chosen.thinking_effort.as_deref(), Some("high"));
        assert_eq!(state.model.as_deref(), Some("netra/text-only"));
    }

    #[tokio::test]
    async fn switching_provider_clears_pi_capture_selection() {
        let runtime = AgentRuntime::new();
        mutate(&runtime.updates, |state| {
            state.provider = "pi".into();
        });
        *runtime.selected_runtime.lock().unwrap() = ModelSelection {
            model: Some("opencode-go/vision".into()),
            thinking_effort: Some("high".into()),
        };
        runtime.select_provider("codex".into()).await.unwrap();
        assert!(runtime.selected_runtime.lock().unwrap().model.is_none());
    }

    #[tokio::test]
    async fn new_session_clears_pi_capture_selection() {
        let runtime = AgentRuntime::new();
        *runtime.selected_runtime.lock().unwrap() = ModelSelection {
            model: Some("opencode-go/vision".into()),
            thinking_effort: None,
        };
        runtime.new_session().await.unwrap();
        assert!(runtime.selected_runtime.lock().unwrap().model.is_none());
    }

    #[test]
    fn model_selection_rejects_capture_conversation_and_superseded_requests() {
        let runtime = AgentRuntime::new();
        let mut previous = runtime.snapshot();
        previous.provider = ProviderId::Pi;
        previous.capture.phase = "idle".into();
        let mut current = previous.clone();
        current.capture.request_id = previous.capture.request_id + 1;
        current.capture.phase = "preparing".into();
        assert!(!runtime_selection_still_current(&previous, &current, 1, 1));
        current.capture.phase = "idle".into();
        assert!(!runtime_selection_still_current(&previous, &current, 1, 1));
        assert!(runtime_selection_still_current(&previous, &previous, 1, 1));
        let mut reopened = previous.clone();
        reopened.conversation_id = "another-conversation".into();
        assert!(!runtime_selection_still_current(&previous, &reopened, 1, 1));
        assert!(!runtime_selection_still_current(&previous, &previous, 1, 2));
    }

    #[tokio::test]
    async fn cannot_change_pi_runtime_while_running() {
        let runtime = AgentRuntime::new();
        mutate(&runtime.updates, |state| {
            state.provider = "pi".into();
            state.status = "streaming".into();
        });
        assert!(
            runtime
                .select_runtime_options(Some("pi/model".into()), None)
                .await
                .is_err()
        );
        assert!(runtime.selected_runtime.lock().unwrap().model.is_none());
    }

    #[tokio::test]
    async fn ordinary_prompt_cannot_overlap_screen_capture() {
        let runtime = AgentRuntime::new();
        mutate(&runtime.updates, |state| {
            state.capture.phase = "capturing".into()
        });
        let error = runtime
            .ask("Explain this".into(), "codex".into(), None, None)
            .await
            .unwrap_err();
        assert!(error.contains("screen capture"));
    }

    #[test]
    fn duplicate_hotkey_never_overwrites_an_active_capture_status() {
        let runtime = AgentRuntime::new();
        runtime.capture_error("Screen capture is already in progress.");
        assert_eq!(runtime.snapshot().status, "idle");
        assert!(runtime.snapshot().error.is_none());
    }

    #[cfg(windows)]
    #[test]
    fn capture_begin_exposes_preparing_and_rejects_overlap() {
        let runtime = AgentRuntime::new();
        let (request_id, reservation) = runtime.begin_capture().expect("capture starts");
        let snapshot = runtime.snapshot();
        assert_eq!(snapshot.capture.request_id, request_id);
        assert_eq!(snapshot.capture.phase, "preparing");
        assert!(runtime.begin_capture().is_err());
        drop(reservation);
        assert!(runtime.begin_capture().is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn capture_failure_is_visible_and_clearable() {
        let runtime = AgentRuntime::new();
        let (_, reservation) = runtime.begin_capture().expect("capture starts");
        drop(reservation);
        runtime.capture_error("Target unavailable.");
        let snapshot = runtime.snapshot();
        assert_eq!(snapshot.capture.phase, "failed");
        assert_eq!(
            snapshot.capture.error.as_deref(),
            Some("Target unavailable.")
        );
        runtime.clear_capture_error();
        assert_eq!(runtime.snapshot().capture.phase, "idle");
    }

    #[cfg(windows)]
    #[test]
    fn stale_capture_failure_does_not_replace_new_request() {
        let runtime = AgentRuntime::new();
        let (old_request_id, old_reservation) = runtime.begin_capture().expect("capture starts");
        drop(old_reservation);
        let (new_request_id, new_reservation) = runtime.begin_capture().expect("capture retries");
        runtime.capture_error_for(old_request_id, "Old capture failed.");
        let snapshot = runtime.snapshot();
        assert_eq!(snapshot.capture.request_id, new_request_id);
        assert_eq!(snapshot.capture.phase, "preparing");
        assert_ne!(snapshot.capture.request_id, old_request_id);
        drop(new_reservation);
    }

    #[cfg(windows)]
    #[test]
    fn capture_configuration_errors_never_change_terminal_agent_outcome() {
        let runtime = AgentRuntime::new();
        mutate(&runtime.updates, |s| {
            s.run_id = 5;
            s.thread_id = Some("thread".into());
            s.status = "completed".into();
        });
        runtime.capture_error("Shortcut unavailable.");
        assert_eq!(runtime.snapshot().status, "completed");
        assert!(
            runtime
                .snapshot()
                .error
                .as_deref()
                .unwrap()
                .starts_with("Capture: ")
        );
        runtime.clear_capture_error();
        assert_eq!(runtime.snapshot().status, "completed");
        assert!(runtime.snapshot().error.is_none());

        mutate(&runtime.updates, |s| {
            s.run_id = 6;
            s.status = "failed".into();
            s.error = Some("Provider failed without an answer.".into());
        });
        runtime.capture_error("No available target.");
        assert_eq!(runtime.snapshot().status, "failed");
        assert_eq!(
            runtime.snapshot().error.as_deref(),
            Some("Provider failed without an answer.")
        );
        runtime.clear_capture_error();
        assert_eq!(runtime.snapshot().status, "failed");
        assert_eq!(
            runtime.snapshot().error.as_deref(),
            Some("Provider failed without an answer.")
        );

        mutate(&runtime.updates, |s| {
            s.status = "idle".into();
            s.thread_id = None;
            s.error = None;
        });
        runtime.capture_error("No available target.");
        assert_eq!(runtime.snapshot().status, "idle");
        assert!(
            runtime
                .snapshot()
                .error
                .as_deref()
                .unwrap()
                .starts_with("Capture: ")
        );
        runtime.clear_capture_error();
        assert_eq!(runtime.snapshot().status, "idle");
        assert!(runtime.snapshot().error.is_none());
    }

    #[cfg(windows)]
    #[test]
    fn capture_reservation_rejects_overlap_and_releases_on_drop() {
        let in_flight = Arc::new(AtomicBool::new(false));
        let first =
            CaptureReservation::acquire(Arc::clone(&in_flight)).expect("first trigger accepted");
        assert!(CaptureReservation::acquire(Arc::clone(&in_flight)).is_err());
        drop(first);
        let again = CaptureReservation::acquire(Arc::clone(&in_flight)).expect("retry accepted");
        drop(again);
        assert!(!in_flight.load(Ordering::Acquire));
    }

    #[test]
    fn old_run_cannot_replace_new_terminal_state() {
        let (tx, _) = watch::channel(Snapshot {
            run_id: 2,
            seq: 4,
            status: "completed".into(),
            provider: "codex".into(),
            conversation_id: String::new(),
            cwd: String::new(),
            thread_id: None,
            model: None,
            thinking_effort: None,
            usage: None,
            messages: vec![],
            capture: CaptureSnapshot::default(),
            error: None,
        });
        events::ProviderEvents::new(tx.clone()).fail(1, "late failure");
        assert_eq!(tx.borrow().status, "completed");
        assert_eq!(tx.borrow().error, None);
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn agy_text_only_headless_input_blocks_capture_before_first_chat() {
        let runtime = AgentRuntime::new();
        runtime
            .select_provider("agy".into())
            .await
            .expect("Agy selection");
        assert_eq!(runtime.snapshot().provider, "agy");
        let (request_id, reservation) = runtime.begin_capture().expect("capture starts");
        let capture = runtime
            .capture_hotkey(
                request_id,
                reservation,
                || -> Result<CapturedImage, String> {
                    panic!("The capture closure must never execute for unsupported Agy images");
                },
            )
            .await;
        assert_eq!(
            capture.unwrap_err(),
            "Agy headless streaming accepts text only. Select Codex or Pi."
        );
        assert!(runtime.snapshot().messages.is_empty());
    }

    #[tokio::test]
    async fn provider_cannot_change_while_session_is_owned() {
        let runtime = AgentRuntime::new();
        assert!(runtime.select_provider("opencode".into()).await.is_err());
        runtime
            .select_provider("agy".into())
            .await
            .expect("Agy should be selectable before the session");
        let (tx, _rx) = mpsc::channel(1);
        *runtime.control.lock().await = Some(tx);
        assert!(
            runtime
                .select_provider_with_timeout("pi".into(), Duration::from_millis(10))
                .await
                .is_err()
        );
        assert_eq!(runtime.snapshot().provider, "agy");
    }

    #[tokio::test]
    async fn stopping_is_visible_before_control_can_be_consumed() {
        let runtime = AgentRuntime::new();
        let (tx, mut rx) = mpsc::channel(1);
        *runtime.control.lock().await = Some(tx);
        mutate(&runtime.updates, |snapshot| {
            snapshot.status = "streaming".into()
        });
        runtime.stop().await.expect("Stop must be accepted");
        assert_eq!(runtime.snapshot().status, "stopping");
        assert!(matches!(rx.try_recv(), Ok(Control::Stop)));
    }

    #[tokio::test]
    async fn stop_is_idempotent_after_the_first_stop_request() {
        let runtime = AgentRuntime::new();
        let (tx, mut rx) = mpsc::channel(2);
        *runtime.control.lock().await = Some(tx);
        mutate(&runtime.updates, |snapshot| {
            snapshot.status = "streaming".into()
        });

        runtime.stop().await.expect("first Stop must be accepted");
        runtime
            .stop()
            .await
            .expect("repeated Stop must be harmless");

        assert_eq!(runtime.snapshot().status, "stopping");
        assert!(matches!(rx.try_recv(), Ok(Control::Stop)));
        assert!(rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn stop_cancels_readiness_without_an_owned_process() {
        let runtime = AgentRuntime::new();
        let cancelled = runtime.begin_run_readiness().unwrap();
        mutate(&runtime.updates, |snapshot| {
            snapshot.run_id = 41;
            snapshot.status = "starting".into();
        });

        let cancellation = tokio::spawn(async move { cancelled.await.is_ok() });
        tokio::time::timeout(Duration::from_millis(100), runtime.stop())
            .await
            .expect("Stop must not wait for readiness")
            .expect("Stop must accept readiness cancellation");
        assert_eq!(runtime.snapshot().status, "stopped");
        assert!(cancellation.await.unwrap());
    }

    #[tokio::test]
    async fn new_session_closes_provider_before_clearing_conversation() {
        let runtime = AgentRuntime::new();
        let (sender, mut receiver) = mpsc::channel(2);
        *runtime.control.lock().await = Some(sender);
        mutate(&runtime.updates, |s| {
            s.run_id = 8;
            s.status = "completed".into();
            s.thread_id = Some("thread-1".into());
            s.messages.push(ChatMessage {
                id: "8:user".into(),
                role: "user".into(),
                text: "hello".into(),
            });
        });

        let (close_seen, observed) = oneshot::channel();
        let (may_finish, proceed) = oneshot::channel();
        let worker = tokio::spawn(async move {
            let Some(Control::Close { claimed, finished }) = receiver.recv().await else {
                panic!("new session must close the existing process");
            };
            assert!(!claimed.swap(true, Ordering::SeqCst));
            close_seen.send(()).unwrap();
            proceed.await.unwrap();
            finished.send(()).unwrap();
        });

        let reset = runtime.new_session();
        tokio::pin!(reset);
        tokio::select! {
            _ = &mut reset => panic!("reset must wait until Codex closes"),
            _ = observed => {
                assert_eq!(runtime.snapshot().status, "completed");
                assert!(runtime.snapshot().thread_id.is_some());
            }
        }
        may_finish.send(()).unwrap();
        reset.await.expect("new session");
        worker.await.unwrap();
        let snapshot = runtime.snapshot();
        assert_eq!(snapshot.status, "idle");
        assert!(snapshot.thread_id.is_none());
        assert!(snapshot.messages.is_empty());
        assert!(runtime.control.lock().await.is_none());
        assert!(snapshot.run_id > 8);
    }

    #[tokio::test]
    async fn claimed_close_without_ack_has_a_bounded_deadline_and_preserves_session() {
        let runtime = AgentRuntime::new();
        let (sender, mut receiver) = mpsc::channel(2);
        *runtime.control.lock().await = Some(sender);
        mutate(&runtime.updates, |s| {
            s.run_id = 8;
            s.status = "completed".into();
            s.thread_id = Some("thread-8".into());
        });
        let (seen, observed) = oneshot::channel();
        let (release, proceed) = oneshot::channel::<()>();
        let worker = tokio::spawn(async move {
            let Some(Control::Close { claimed, finished }) = receiver.recv().await else {
                panic!("close required");
            };
            assert!(!claimed.swap(true, Ordering::SeqCst));
            seen.send(()).unwrap();
            proceed.await.unwrap();
            finished.send(()).ok();
        });

        let closing = runtime.new_session_with_timeout(Duration::from_millis(250));
        tokio::pin!(closing);
        tokio::select! {
            _ = &mut closing => panic!("close must not reset before the worker acknowledges"),
            result = observed => assert!(result.is_ok()),
        }
        let result = timeout(Duration::from_secs(1), &mut closing)
            .await
            .expect("close timeout must be bounded");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("still closing"));
        assert_eq!(runtime.snapshot().status, "completed");
        assert_eq!(runtime.snapshot().thread_id.as_deref(), Some("thread-8"));
        release.send(()).unwrap();
        worker.await.unwrap();
        runtime
            .new_session_with_timeout(Duration::from_secs(1))
            .await
            .expect("retry after closure");
        assert_eq!(runtime.snapshot().status, "idle");
    }

    #[test]
    fn timed_out_close_is_not_executed_late() {
        let claimed = AtomicBool::new(false);

        assert!(!claimed.swap(true, Ordering::SeqCst));

        assert!(claimed.swap(true, Ordering::SeqCst));
    }

    #[tokio::test]
    async fn new_session_does_not_reset_an_active_capture() {
        let runtime = AgentRuntime::new();
        let initial = runtime.snapshot();
        mutate(&runtime.updates, |state| {
            state.capture.request_id = 3;
            state.capture.phase = "preparing".into();
        });
        assert!(runtime.new_session().await.is_err());
        let current = runtime.snapshot();
        assert_eq!(current.conversation_id, initial.conversation_id);
        assert_eq!(current.run_id, initial.run_id);
        assert_eq!(current.capture.request_id, 3);
        assert_eq!(current.capture.phase, "preparing");
        assert_eq!(
            *runtime.conversation.id.lock().unwrap(),
            initial.conversation_id
        );

        mutate(&runtime.updates, |state| {
            state.capture.phase = "failed".into()
        });
        runtime.new_session().await.unwrap();
        assert_ne!(runtime.snapshot().conversation_id, initial.conversation_id);
    }

    #[tokio::test]
    async fn new_session_cannot_discard_running_request() {
        let runtime = AgentRuntime::new();
        for status in ["starting", "streaming", "stopping"] {
            mutate(&runtime.updates, |s| s.status = status.into());
            assert!(runtime.new_session().await.is_err(), "{status}");
            assert_eq!(runtime.snapshot().status, status);
        }
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn timed_out_capture_keeps_native_work_reserved_until_it_finishes() {
        let in_flight = Arc::new(AtomicBool::new(false));
        let reservation = Arc::new(CaptureReservation::acquire(Arc::clone(&in_flight)).unwrap());
        let (started_tx, started_rx) = oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
        let attempt = tokio::spawn({
            let reservation = Arc::clone(&reservation);
            async move {
                capture_with_deadline(&reservation, Duration::from_millis(40), move || {
                    let _ = started_tx.send(());
                    let _ = release_rx.recv();
                    Err("simulated blocked capture".into())
                })
                .await
            }
        });
        started_rx.await.expect("worker entered blocking operation");
        drop(reservation);
        let outcome = attempt.await.expect("timeout task completed");
        match outcome {
            Err(message) => assert!(message.contains("timed out")),
            Ok(_) => panic!("blocked capture must time out"),
        }
        assert!(CaptureReservation::acquire(Arc::clone(&in_flight)).is_err());
        release_tx.send(()).unwrap();
        timeout(Duration::from_secs(2), async {
            while in_flight.load(Ordering::SeqCst) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("native worker eventually released capture reservation");
        assert!(CaptureReservation::acquire(in_flight).is_ok());
    }

    #[test]
    fn default_workspace_uses_home_root_and_expands_tilde_children() {
        let home = default_workspace_path();
        assert_eq!(resolve_workspace_path("~"), home);
        assert_eq!(resolve_workspace_path(""), home);
        assert_eq!(resolve_workspace_path("~/otto"), home.join("otto"));
    }
}
