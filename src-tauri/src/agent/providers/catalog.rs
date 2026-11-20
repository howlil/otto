use crate::agent::ProviderId;
use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDescriptor {
    pub id: ProviderId,
    pub display_name: &'static str,
    pub command: &'static str,
    pub installed: bool,
}

impl ProviderId {
    pub fn catalog() -> Vec<ProviderDescriptor> {
        Self::ALL
            .into_iter()
            .map(|id| ProviderDescriptor {
                id,
                display_name: id.display_name(),
                command: id.command(),
                installed: id.is_installed(),
            })
            .collect()
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::Codex => "Codex",
            Self::Pi => "Pi",
            Self::Agy => "Agy",
            Self::Opencode => "OpenCode",
            Self::Claude => "Claude Code",
            Self::Gemini => "Gemini CLI",
            Self::Copilot => "GitHub Copilot",
            Self::Qwen => "Qwen Code",
            Self::Cursor => "Cursor Agent",
            Self::Goose => "Goose",
            Self::Vibe => "Mistral Vibe",
            Self::Amp => "Amp",
            Self::Kilo => "Kilo Code",
            Self::Junie => "Junie",
            Self::Cline => "Cline",
            Self::Augment => "Augment Code",
            Self::Droid => "Factory Droid",
            Self::Grok => "Grok Build",
            Self::Devin => "Devin",
        }
    }

    pub fn command(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Pi => "pi",
            Self::Agy => "agy",
            Self::Opencode => "opencode",
            Self::Claude => "claude",
            Self::Gemini => "gemini",
            Self::Copilot => "copilot",
            Self::Qwen => "qwen",
            Self::Cursor => "agent",
            Self::Goose => "goose",
            Self::Vibe => "vibe-acp",
            Self::Amp => "amp-acp",
            Self::Kilo => "kilo",
            Self::Junie => "junie",
            Self::Cline => "cline",
            Self::Augment => "auggie",
            Self::Droid => "droid",
            Self::Grok => "grok",
            Self::Devin => "devin",
        }
    }

    pub(in crate::agent) fn is_installed(self) -> bool {
        match self {
            Self::Codex => super::codex::executable().is_some(),
            #[cfg(windows)]
            Self::Pi => super::pi::executable().is_some(),
            #[cfg(windows)]
            Self::Opencode => super::opencode::executable().is_some(),
            #[cfg(windows)]
            Self::Claude => super::claude::executable().is_some(),
            #[cfg(windows)]
            acp => acp
                .acp_spec()
                .is_some_and(|spec| super::acp::executable(spec).is_some()),
            #[cfg(not(windows))]
            _ => false,
        }
    }
}
