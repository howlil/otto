use crate::agent::ProviderId;

#[derive(Debug)]
pub(in crate::agent) struct AcpSpec {
    pub name: &'static str,
    pub executables: &'static [&'static str],
    pub args: &'static [&'static str],
    pub authenticate: Option<&'static str>,
    pub env: &'static [(&'static str, &'static str)],
}

static AGY: AcpSpec = AcpSpec {
    name: "Agy",
    executables: &["agy.exe", "agy.cmd"],
    args: &["acp", "--stdio"],
    authenticate: None,
    env: &[],
};

static GEMINI: AcpSpec = AcpSpec {
    name: "Gemini CLI",
    executables: &["gemini.exe", "gemini.cmd"],
    args: &["--acp"],
    authenticate: None,
    env: &[],
};

static COPILOT: AcpSpec = AcpSpec {
    name: "GitHub Copilot",
    executables: &["copilot.exe", "copilot.cmd"],
    args: &["--acp"],
    authenticate: None,
    env: &[],
};

static QWEN: AcpSpec = AcpSpec {
    name: "Qwen Code",
    executables: &["qwen.exe", "qwen.cmd"],
    args: &["--acp"],
    authenticate: None,
    env: &[],
};

static CURSOR: AcpSpec = AcpSpec {
    name: "Cursor Agent",
    executables: &[
        "agent.exe",
        "agent.cmd",
        "cursor-agent.exe",
        "cursor-agent.cmd",
    ],
    args: &["acp"],
    authenticate: Some("cursor_login"),
    env: &[],
};

static GOOSE: AcpSpec = AcpSpec {
    name: "Goose",
    executables: &["goose.exe", "goose.cmd"],
    args: &["acp"],
    authenticate: None,
    env: &[],
};

static VIBE: AcpSpec = AcpSpec {
    name: "Mistral Vibe",
    executables: &["vibe-acp.exe"],
    args: &[],
    authenticate: None,
    env: &[],
};

static AMP: AcpSpec = AcpSpec {
    name: "Amp",
    executables: &["amp-acp.exe"],
    args: &[],
    authenticate: None,
    env: &[],
};

static KILO: AcpSpec = AcpSpec {
    name: "Kilo Code",
    executables: &["kilo.exe", "kilo.cmd"],
    args: &["acp"],
    authenticate: None,
    env: &[],
};

static JUNIE: AcpSpec = AcpSpec {
    name: "Junie",
    executables: &["junie.exe"],
    args: &["--acp=true"],
    authenticate: None,
    env: &[],
};

static CLINE: AcpSpec = AcpSpec {
    name: "Cline",
    executables: &["cline.exe", "cline.cmd"],
    args: &["--acp"],
    authenticate: None,
    env: &[],
};

static AUGMENT: AcpSpec = AcpSpec {
    name: "Augment Code",
    executables: &["auggie.exe", "auggie.cmd"],
    args: &["--acp"],
    authenticate: None,
    env: &[("AUGMENT_DISABLE_AUTO_UPDATE", "1")],
};

static DROID: AcpSpec = AcpSpec {
    name: "Factory Droid",
    executables: &["droid.exe", "droid.cmd"],
    args: &["exec", "--output-format", "acp-daemon"],
    authenticate: None,
    env: &[
        ("DROID_DISABLE_AUTO_UPDATE", "true"),
        ("FACTORY_DROID_AUTO_UPDATE_ENABLED", "false"),
    ],
};

static GROK: AcpSpec = AcpSpec {
    name: "Grok Build",
    executables: &["grok.exe", "grok.cmd"],
    args: &["agent", "stdio"],
    authenticate: None,
    env: &[],
};

static DEVIN: AcpSpec = AcpSpec {
    name: "Devin",
    executables: &["devin.exe"],
    args: &["acp"],
    authenticate: None,
    env: &[],
};

impl ProviderId {
    pub(in crate::agent) fn acp_spec(self) -> Option<&'static AcpSpec> {
        match self {
            Self::Agy => Some(&AGY),
            Self::Gemini => Some(&GEMINI),
            Self::Copilot => Some(&COPILOT),
            Self::Qwen => Some(&QWEN),
            Self::Cursor => Some(&CURSOR),
            Self::Goose => Some(&GOOSE),
            Self::Vibe => Some(&VIBE),
            Self::Amp => Some(&AMP),
            Self::Kilo => Some(&KILO),
            Self::Junie => Some(&JUNIE),
            Self::Cline => Some(&CLINE),
            Self::Augment => Some(&AUGMENT),
            Self::Droid => Some(&DROID),
            Self::Grok => Some(&GROK),
            Self::Devin => Some(&DEVIN),
            Self::Codex | Self::Pi | Self::Opencode | Self::Claude => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_acp_provider_has_a_distinct_name_and_a_launch_mode() {
        let specs: Vec<_> = ProviderId::ALL
            .into_iter()
            .filter_map(ProviderId::acp_spec)
            .collect();
        assert_eq!(specs.len(), 15);
        for spec in &specs {
            assert!(
                spec.executables
                    .iter()
                    .all(|name| name.ends_with(".exe") || name.ends_with(".cmd"))
            );
        }
        let names: std::collections::HashSet<_> = specs.iter().map(|spec| spec.name).collect();
        assert_eq!(names.len(), specs.len());
    }

    #[test]
    fn documented_launch_commands_are_preserved() {
        assert_eq!(ProviderId::Agy.acp_spec().unwrap().args, ["acp", "--stdio"]);
        assert_eq!(ProviderId::Gemini.acp_spec().unwrap().args, ["--acp"]);
        assert_eq!(ProviderId::Copilot.acp_spec().unwrap().args, ["--acp"]);
        assert_eq!(ProviderId::Qwen.acp_spec().unwrap().args, ["--acp"]);
        assert_eq!(ProviderId::Goose.acp_spec().unwrap().args, ["acp"]);
        let cursor = ProviderId::Cursor.acp_spec().unwrap();
        assert_eq!(cursor.args, ["acp"]);
        assert_eq!(cursor.authenticate, Some("cursor_login"));
        assert!(ProviderId::Vibe.acp_spec().unwrap().args.is_empty());
        assert_eq!(ProviderId::Junie.acp_spec().unwrap().args, ["--acp=true"]);
        assert_eq!(
            ProviderId::Droid.acp_spec().unwrap().args,
            ["exec", "--output-format", "acp-daemon"]
        );
        assert_eq!(
            ProviderId::Grok.acp_spec().unwrap().args,
            ["agent", "stdio"]
        );
        assert!(
            ProviderId::Droid
                .acp_spec()
                .unwrap()
                .env
                .iter()
                .any(|(key, _)| *key == "DROID_DISABLE_AUTO_UPDATE")
        );
    }
}
