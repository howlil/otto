use serde::Serialize;

#[derive(Clone, Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PendingApproval {
    pub approval_id: String,
    pub run_id: u64,
    pub kind: String,
    pub title: String,
    pub detail: String,
    pub reason: Option<String>,
}

#[derive(Clone, Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolActivity {
    pub kind: String,
    pub summary: String,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ApprovalDecision {
    AllowOnce,
    Deny,
}

impl ApprovalDecision {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "allowOnce" => Ok(Self::AllowOnce),
            "deny" => Ok(Self::Deny),
            _ => Err("Unknown approval decision.".into()),
        }
    }

    pub fn provider_verb(self) -> &'static str {
        match self {
            Self::AllowOnce => "accept",
            Self::Deny => "cancel",
        }
    }
}

pub const MAX_DETAIL: usize = 400;

pub fn bounded(text: &str) -> String {
    let trimmed = text.trim();
    let mut out: String = trimmed.chars().take(MAX_DETAIL).collect();
    if trimmed.chars().count() > MAX_DETAIL {
        out.push('…');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decisions_are_fail_closed_and_deny_cancels() {
        assert_eq!(
            ApprovalDecision::parse("allowOnce"),
            Ok(ApprovalDecision::AllowOnce)
        );
        assert_eq!(ApprovalDecision::parse("deny"), Ok(ApprovalDecision::Deny));
        assert!(ApprovalDecision::parse("accept").is_err());
        assert!(ApprovalDecision::parse("allowForSession").is_err());
        assert!(ApprovalDecision::parse("").is_err());
        assert_eq!(ApprovalDecision::AllowOnce.provider_verb(), "accept");
        assert_eq!(ApprovalDecision::Deny.provider_verb(), "cancel");
    }

    #[test]
    fn details_are_bounded() {
        assert_eq!(bounded("  rm -rf build  "), "rm -rf build");
        let long = "a".repeat(MAX_DETAIL + 50);
        let out = bounded(&long);
        assert_eq!(out.chars().count(), MAX_DETAIL + 1);
        assert!(out.ends_with('…'));
    }
}
