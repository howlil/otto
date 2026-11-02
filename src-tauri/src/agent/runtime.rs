use super::{RunPhase, Snapshot};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProviderId {
    #[default]
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::agent) struct RuntimeCapabilities {
    pub image_transport: bool,
    pub pending_model_selection: bool,
    pub completed_followup_without_probe: bool,
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
}

pub(in crate::agent) struct SessionReuse<'a> {
    pub provider: ProviderId,
    pub status: RunPhase,
    pub thread_id: Option<&'a str>,
    pub current_cwd: &'a Path,
    pub requested_cwd: &'a Path,
    pub model: Option<&'a str>,
    pub thinking_effort: Option<&'a str>,
    pub has_capture: bool,
}

impl<'a> SessionReuse<'a> {
    pub fn for_turn(
        snapshot: &'a Snapshot,
        requested_cwd: &'a Path,
        model: Option<&'a str>,
        thinking_effort: Option<&'a str>,
        has_capture: bool,
    ) -> Self {
        Self {
            provider: snapshot.provider,
            status: snapshot.status,
            thread_id: snapshot.thread_id.as_deref(),
            current_cwd: Path::new(&snapshot.cwd),
            requested_cwd,
            model,
            thinking_effort,
            has_capture,
        }
    }
}
