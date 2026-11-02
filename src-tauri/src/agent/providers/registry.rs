use crate::agent::events::ProviderEvents;
use crate::agent::runtime::{ProviderId, RuntimeCapabilities, SessionReuse};
use crate::agent::{Control, ModelSelection, ProviderReadiness, RunPhase, Snapshot};
use std::path::PathBuf;
use tokio::sync::{mpsc, watch};


impl ProviderId {
    pub(in crate::agent) fn capabilities(self) -> RuntimeCapabilities {
        match self {
            Self::Codex => RuntimeCapabilities {
                image_transport: true,
                pending_model_selection: false,
                completed_followup_without_probe: false,
            },
            Self::Pi => RuntimeCapabilities {
                image_transport: true,
                pending_model_selection: true,
                completed_followup_without_probe: false,
            },
            Self::Agy => RuntimeCapabilities {
                image_transport: false,
                pending_model_selection: false,
                completed_followup_without_probe: true,
            },
        }
    }

    pub(in crate::agent) fn is_installed(self) -> bool {
        match self {
            Self::Codex => super::codex::executable().is_some(),
            #[cfg(windows)]
            Self::Pi => super::pi::executable().is_some(),
            #[cfg(windows)]
            Self::Agy => super::agy::executable().is_some(),
            #[cfg(not(windows))]
            Self::Pi | Self::Agy => false,
        }
    }

    pub(in crate::agent) fn options_for_capture(
        self,
        previous: &ModelSelection,
        pending: &ModelSelection,
    ) -> ModelSelection {
        if self.capabilities().pending_model_selection {
            pending.clone()
        } else {
            previous.clone()
        }
    }

    pub(in crate::agent) fn can_reuse_without_probe(
        self,
        session: &SessionReuse<'_>,
    ) -> bool {
        self.capabilities().completed_followup_without_probe
            && session.provider == self
            && session.status == RunPhase::Completed
            && session.thread_id.is_some()
            && session.current_cwd == session.requested_cwd
            && session.model.is_none()
            && session.thinking_effort.is_none()
            && !session.has_capture
    }

    pub(in crate::agent) fn capture_unavailable_reason(self) -> Option<&'static str> {
        match self {
            Self::Agy => Some("Agy headless streaming accepts text only. Select Codex or Pi."),
            Self::Codex | Self::Pi => None,
        }
    }

    pub fn image_transport(self) -> bool {
        self.capabilities().image_transport
    }

    pub fn validate(self, has_image: bool) -> Result<(), String> {
        if has_image && !self.image_transport() {
            return Err("Agy chat accepts text only.".into());
        }
        Ok(())
    }

    pub async fn readiness(self, cwd: &PathBuf, model: Option<&str>) -> ProviderReadiness {
        let mut ready = match self {
            Self::Codex => super::codex::readiness(cwd).await,
            #[cfg(windows)]
            Self::Pi => super::pi::readiness(cwd, model).await,
            #[cfg(windows)]
            Self::Agy => super::agy::readiness(cwd).await,
            #[cfg(not(windows))]
            Self::Pi | Self::Agy => ProviderReadiness::new(
                "unsupported",
                "Local CLI adapters require Windows.",
                "Run Otto on Windows.",
            ),
        };
        ready.image_transport = self.image_transport();
        ready
    }

    pub async fn run(
        self,
        controls: mpsc::Receiver<Control>,
        updates: watch::Sender<Snapshot>,
        initial: Control,
    ) {
        match self {
            Self::Codex => super::codex::run(controls, ProviderEvents::new(updates), initial).await,
            #[cfg(windows)]
            Self::Pi => super::pi::run(controls, ProviderEvents::new(updates), initial).await,
            #[cfg(windows)]
            Self::Agy => super::agy::run(controls, ProviderEvents::new(updates), initial).await,
            #[cfg(not(windows))]
            Self::Pi | Self::Agy => {
                let run_id = updates.borrow().run_id;
                ProviderEvents::new(updates).fail(run_id, "This provider requires Windows.");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_registry_rejects_unknown_and_unsupported_privileges() {
        assert!(ProviderId::parse("opencode").is_none());
        assert!(ProviderId::parse("Codex").is_none());
        for id in ["codex", "pi", "agy"] {
            assert_eq!(ProviderId::parse(id).unwrap().as_str(), id);
            assert!(ProviderId::parse(id).unwrap().validate(false).is_ok());
        }
        assert!(ProviderId::Agy.validate(true).is_err());
        assert!(ProviderId::Pi.validate(true).is_ok());
        assert!(ProviderId::Codex.validate(false).is_ok());
    }

    #[test]
    fn runtime_capabilities_preserve_image_and_model_selection_behavior() {
        let codex = ProviderId::Codex.capabilities();
        let pi = ProviderId::Pi.capabilities();
        let agy = ProviderId::Agy.capabilities();
        assert!(codex.image_transport);
        assert!(!codex.pending_model_selection);
        assert!(pi.image_transport);
        assert!(pi.pending_model_selection);
        assert!(!agy.image_transport);
        assert!(agy.completed_followup_without_probe);
        assert!(!pi.completed_followup_without_probe);
        assert_eq!(
            ProviderId::Agy.capture_unavailable_reason(),
            Some("Agy headless streaming accepts text only. Select Codex or Pi.")
        );
        assert_eq!(ProviderId::Pi.capture_unavailable_reason(), None);
    }

    #[test]
    fn pending_model_selection_is_used_only_when_adapter_requires_it() {
        let previous = ModelSelection {
            model: Some("previous".into()),
            thinking_effort: Some("off".into()),
        };
        let pending = ModelSelection {
            model: Some("new".into()),
            thinking_effort: Some("high".into()),
        };
        let chosen_pi = ProviderId::Pi.options_for_capture(&previous, &pending);
        assert_eq!(chosen_pi.model.as_deref(), Some("new"));
        assert_eq!(chosen_pi.thinking_effort.as_deref(), Some("high"));
        for provider in [ProviderId::Codex, ProviderId::Agy] {
            let chosen = provider.options_for_capture(&previous, &pending);
            assert_eq!(chosen.model.as_deref(), Some("previous"));
            assert_eq!(chosen.thinking_effort.as_deref(), Some("off"));
        }
    }

    #[test]
    fn completed_followup_reuse_respects_provider_context_and_changes() {
        let cwd = std::fs::canonicalize(std::env::current_dir().unwrap()).unwrap();
        let mut snapshot = crate::agent::AgentRuntime::new().snapshot();
        snapshot.provider = ProviderId::Agy;
        snapshot.status = RunPhase::Completed;
        snapshot.thread_id = Some("agy-conversation".into());
        snapshot.cwd = cwd.to_string_lossy().into_owned();

        let eligible = |snapshot: &Snapshot, path: &std::path::Path,
                        model: Option<&str>, effort: Option<&str>, capture: bool| {
            snapshot.provider.can_reuse_without_probe(&SessionReuse::for_turn(
                snapshot, path, model, effort, capture,
            ))
        };
        assert!(eligible(&snapshot, &cwd, None, None, false));
        assert!(!eligible(&snapshot, &cwd, Some("other"), None, false));
        assert!(!eligible(&snapshot, &cwd, None, Some("high"), false));
        assert!(!eligible(&snapshot, &cwd, None, None, true));
        assert!(!eligible(&snapshot, &cwd.join("other"), None, None, false));
        snapshot.thread_id = None;
        assert!(!eligible(&snapshot, &cwd, None, None, false));
        snapshot.thread_id = Some("agy-conversation".into());
        snapshot.status = RunPhase::Failed;
        assert!(!eligible(&snapshot, &cwd, None, None, false));
        snapshot.status = RunPhase::Completed;
        snapshot.provider = ProviderId::Pi;
        assert!(!eligible(&snapshot, &cwd, None, None, false));
        snapshot.provider = ProviderId::Agy;
        let context = SessionReuse::for_turn(&snapshot, &cwd, None, None, false);
        assert!(!ProviderId::Codex.can_reuse_without_probe(&context));
    }
}
