use crate::agent::events::ProviderEvents;
use crate::agent::{Control, ProviderReadiness, Snapshot};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::sync::{mpsc, watch};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProviderId {
    Codex,
    Pi,
    Agy,
}

#[cfg(test)]
impl From<&str> for ProviderId {
    fn from(value: &str) -> Self {
        Self::parse(value).unwrap()
    }
}

#[cfg(test)]
impl PartialEq<&str> for ProviderId {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
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

    pub fn image_transport(self) -> bool {
        matches!(self, Self::Codex | Self::Pi)
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
}
