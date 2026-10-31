use serde_json::{Value, json};

// K2 -> K3: Quick Ask vs Agent Session is a policy decision here, not a UI label.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum InteractionMode {
    QuickAsk,
    AgentSession,
}

impl InteractionMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::QuickAsk => "quickAsk",
            Self::AgentSession => "agentSession",
        }
    }

    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "quickAsk" => Ok(Self::QuickAsk),
            "agentSession" => Ok(Self::AgentSession),
            _ => Err("Unknown agent mode.".into()),
        }
    }
}

// thread/start takes SandboxMode (string) + AskForApproval (string).
pub fn thread_start(cwd: &str, mode: InteractionMode) -> Value {
    let (sandbox, approval) = match mode {
        InteractionMode::QuickAsk => ("read-only", "never"),
        InteractionMode::AgentSession => ("workspace-write", "on-request"),
    };
    json!({
        "cwd": cwd,
        "sandbox": sandbox,
        "approvalPolicy": approval,
        "ephemeral": true
    })
}

// turn/start takes SandboxPolicy (tagged object) + AskForApproval (string).
pub fn turn_start(thread_id: &str, text: &str, mode: InteractionMode) -> Value {
    let (sandbox_policy, approval) = match mode {
        InteractionMode::QuickAsk => (json!({ "type": "readOnly" }), "never"),
        InteractionMode::AgentSession => (json!({ "type": "workspaceWrite" }), "on-request"),
    };
    json!({
        "threadId": thread_id,
        "input": [{ "type": "text", "text": text }],
        "sandboxPolicy": sandbox_policy,
        "approvalPolicy": approval
    })
}

// Unknown/missing effective sandbox metadata is not permission to run.
pub fn thread_matches_policy(response: &Value, mode: InteractionMode) -> bool {
    let sandbox = response.pointer("/sandbox/type").and_then(Value::as_str);
    let approval = response.get("approvalPolicy").and_then(Value::as_str);
    match mode {
        InteractionMode::QuickAsk => sandbox == Some("readOnly") && approval == Some("never"),
        InteractionMode::AgentSession => {
            sandbox == Some("workspaceWrite") && approval == Some("on-request")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quick_ask_denies_writable_or_unknown_policy() {
        assert!(!thread_matches_policy(
            &json!({ "thread": {} }),
            InteractionMode::QuickAsk
        ));
        assert!(!thread_matches_policy(
            &json!({ "sandbox": { "type": "workspaceWrite" }, "approvalPolicy": "never" }),
            InteractionMode::QuickAsk
        ));
        assert!(!thread_matches_policy(
            &json!({ "sandbox": { "type": "readOnly" }, "approvalPolicy": "on-request" }),
            InteractionMode::QuickAsk
        ));
        assert!(!thread_matches_policy(
            &json!({ "sandbox": { "type": "readOnly" } }),
            InteractionMode::QuickAsk
        ));
        assert!(thread_matches_policy(
            &json!({ "thread": { "id": "thr" }, "sandbox": { "type": "readOnly" }, "approvalPolicy": "never" }),
            InteractionMode::QuickAsk
        ));
    }

    #[test]
    fn agent_session_requires_workspace_write_and_on_request() {
        assert!(thread_matches_policy(
            &json!({ "sandbox": { "type": "workspaceWrite" }, "approvalPolicy": "on-request" }),
            InteractionMode::AgentSession
        ));
        // A read-only thread must not be treated as an approval-capable session.
        assert!(!thread_matches_policy(
            &json!({ "sandbox": { "type": "readOnly" }, "approvalPolicy": "on-request" }),
            InteractionMode::AgentSession
        ));
        // Fail closed when the provider silently widens approval.
        assert!(!thread_matches_policy(
            &json!({ "sandbox": { "type": "workspaceWrite" }, "approvalPolicy": "never" }),
            InteractionMode::AgentSession
        ));
        assert!(!thread_matches_policy(
            &json!({ "sandbox": { "type": "workspaceWrite" }, "approvalPolicy": "untrusted" }),
            InteractionMode::AgentSession
        ));
        assert!(!thread_matches_policy(
            &json!({}),
            InteractionMode::AgentSession
        ));
    }

    #[test]
    fn quick_ask_launch_never_enables_writes() {
        let p = thread_start("C:/project", InteractionMode::QuickAsk);
        assert_eq!(p["sandbox"], "read-only");
        assert_eq!(p["approvalPolicy"], "never");
        let t = turn_start("t", "explain", InteractionMode::QuickAsk);
        assert_eq!(t["sandboxPolicy"]["type"], "readOnly");
        assert_eq!(t["approvalPolicy"], "never");
    }

    #[test]
    fn agent_session_launch_uses_workspace_write_and_on_request() {
        let p = thread_start("C:/project", InteractionMode::AgentSession);
        assert_eq!(p["sandbox"], "workspace-write");
        assert_eq!(p["approvalPolicy"], "on-request");
        let t = turn_start("t", "edit", InteractionMode::AgentSession);
        assert_eq!(t["sandboxPolicy"]["type"], "workspaceWrite");
        assert_eq!(t["approvalPolicy"], "on-request");
    }

    #[test]
    fn mode_parsing_is_fail_closed() {
        assert_eq!(
            InteractionMode::parse("quickAsk"),
            Ok(InteractionMode::QuickAsk)
        );
        assert_eq!(
            InteractionMode::parse("agentSession"),
            Ok(InteractionMode::AgentSession)
        );
        assert!(InteractionMode::parse("agent").is_err());
        assert!(InteractionMode::parse("").is_err());
    }
}
