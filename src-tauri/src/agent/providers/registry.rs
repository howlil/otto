#[cfg(not(windows))]
use crate::agent::fail;
use crate::agent::events::ProviderEvents;
use crate::agent::policy::InteractionMode;
use crate::agent::{Control, ProviderReadiness, Snapshot};
use std::path::PathBuf;
use tokio::sync::{mpsc, watch};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProviderId {
    Codex,
    Pi,
    Agy,
}

impl ProviderId {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "codex" => Some(Self::Codex),
            "pi" => Some(Self::Pi),
            "agy" => Some(Self::Agy),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Pi => "pi",
            Self::Agy => "agy",
        }
    }

    pub fn agent_session(self) -> bool {
        matches!(self, Self::Codex)
    }

    pub fn image_transport(self) -> bool {
        matches!(self, Self::Codex | Self::Pi)
    }

    pub fn validate(self, mode: InteractionMode, has_image: bool) -> Result<(), String> {
        if mode == InteractionMode::AgentSession && !self.agent_session() {
            return Err("This provider supports tool-free Quick Ask only.".into());
        }
        if has_image && !self.image_transport() {
            return Err("Agy headless streaming accepts text only.".into());
        }
        Ok(())
    }

    pub async fn readiness(self, cwd: &PathBuf) -> ProviderReadiness {
        let mut ready = match self {
            Self::Codex => super::codex::readiness(cwd).await,
            #[cfg(windows)]
            Self::Pi => super::pi::readiness(cwd).await,
            #[cfg(windows)]
            Self::Agy => super::agy::readiness(cwd).await,
            #[cfg(not(windows))]
            Self::Pi | Self::Agy => ProviderReadiness::new(
                "unsupported",
                "Local CLI adapters require Windows.",
                "Run Otto on Windows.",
            ),
        };
        ready.agent_session = self.agent_session();
        ready.image_transport = self.image_transport();
        ready
    }

    pub async fn run(
        self,
        controls: mpsc::Receiver<Control>,
        updates: watch::Sender<Snapshot>,
        initial: Control,
        mode: InteractionMode,
    ) {
        match self {
            Self::Codex => super::codex::run(controls, updates, initial, mode).await,
            #[cfg(windows)]
            Self::Pi => super::pi::run(controls, ProviderEvents::new(updates), initial).await,
            #[cfg(windows)]
            Self::Agy => super::agy::run(controls, updates, initial).await,
            #[cfg(not(windows))]
            Self::Pi | Self::Agy => {
                let run_id = updates.borrow().run_id;
                fail(&updates, run_id, "This provider requires Windows.");
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
            assert!(
                ProviderId::parse(id)
                    .unwrap()
                    .validate(InteractionMode::QuickAsk, false)
                    .is_ok()
            );
        }
        assert!(
            ProviderId::Pi
                .validate(InteractionMode::AgentSession, false)
                .is_err()
        );
        assert!(
            ProviderId::Agy
                .validate(InteractionMode::AgentSession, false)
                .is_err()
        );
        assert!(
            ProviderId::Agy
                .validate(InteractionMode::QuickAsk, true)
                .is_err()
        );
        assert!(
            ProviderId::Pi
                .validate(InteractionMode::QuickAsk, true)
                .is_ok()
        );
        assert!(
            ProviderId::Codex
                .validate(InteractionMode::AgentSession, false)
                .is_ok()
        );
    }
}
