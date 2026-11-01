use serde_json::{Value, json};

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

pub fn thread_start(
    cwd: &str,
    mode: InteractionMode,
    model: Option<&str>,
    thinking_effort: Option<&str>,
) -> Value {
    let (sandbox, approval) = match mode {
        InteractionMode::QuickAsk => ("read-only", "never"),
        InteractionMode::AgentSession => ("workspace-write", "on-request"),
    };
    let mut request = json!({
        "cwd": cwd,
        "sandbox": sandbox,
        "approvalPolicy": approval,
        "ephemeral": true
    });
    if let Some(model) = model {
        request["model"] = json!(model);
    }
    if let Some(effort) = thinking_effort {
        request["reasoningEffort"] = json!(effort);
    }
    request
}

pub fn turn_start(
    thread_id: &str,
    text: &str,
    mode: InteractionMode,
    model: Option<&str>,
    thinking_effort: Option<&str>,
) -> Value {
    let (sandbox_policy, approval) = match mode {
        InteractionMode::QuickAsk => (json!({ "type": "readOnly" }), "never"),
        InteractionMode::AgentSession => (json!({ "type": "workspaceWrite" }), "on-request"),
    };
    let mut request = json!({
        "threadId": thread_id,
        "input": [{ "type": "text", "text": text }],
        "sandboxPolicy": sandbox_policy,
        "approvalPolicy": approval
    });
    if let Some(model) = model {
        request["model"] = json!(model);
    }
    if let Some(effort) = thinking_effort {
        request["effort"] = json!(effort);
    }
    request
}

pub fn turn_start_with_image(
    thread_id: &str,
    text: &str,
    mode: InteractionMode,
    model: Option<&str>,
    thinking_effort: Option<&str>,
    image: Option<&std::path::Path>,
) -> Value {
    let mut request = turn_start(thread_id, text, mode, model, thinking_effort);
    if let Some(path) = image
        && let Some(inputs) = request["input"].as_array_mut()
    {
        inputs.push(json!({ "type": "localImage", "path": path.to_string_lossy() }));
    }
    request
}

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
    fn screenshot_is_a_separate_local_image_input_not_part_of_prompt() {
        let image = std::path::Path::new("C:/Users/test/AppData/Local/Temp/otto.png");
        let request = turn_start_with_image(
            "thread",
            "Analyze this",
            InteractionMode::QuickAsk,
            None,
            None,
            Some(image),
        );
        assert_eq!(request["input"][0]["type"], "text");
        assert_eq!(request["input"][1]["type"], "localImage");
        assert_eq!(
            request["input"][1]["path"],
            image.to_string_lossy().as_ref()
        );
        assert_eq!(request["sandboxPolicy"]["type"], "readOnly");
        assert_eq!(
            turn_start_with_image("thread", "Hi", InteractionMode::QuickAsk, None, None, None),
            turn_start("thread", "Hi", InteractionMode::QuickAsk, None, None)
        );
    }

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

        assert!(!thread_matches_policy(
            &json!({ "sandbox": { "type": "readOnly" }, "approvalPolicy": "on-request" }),
            InteractionMode::AgentSession
        ));

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
        let p = thread_start("C:/project", InteractionMode::QuickAsk, None, None);
        assert_eq!(p["sandbox"], "read-only");
        assert_eq!(p["approvalPolicy"], "never");
        let t = turn_start("t", "explain", InteractionMode::QuickAsk, None, None);
        assert_eq!(t["sandboxPolicy"]["type"], "readOnly");
        assert_eq!(t["approvalPolicy"], "never");
    }

    #[test]
    fn agent_session_launch_uses_workspace_write_and_on_request() {
        let p = thread_start("C:/project", InteractionMode::AgentSession, None, None);
        assert_eq!(p["sandbox"], "workspace-write");
        assert_eq!(p["approvalPolicy"], "on-request");
        let t = turn_start("t", "edit", InteractionMode::AgentSession, None, None);
        assert_eq!(t["sandboxPolicy"]["type"], "workspaceWrite");
        assert_eq!(t["approvalPolicy"], "on-request");
    }

    #[test]
    fn model_and_thinking_effort_are_forwarded_to_codex_requests() {
        let thread = thread_start(
            "C:/project",
            InteractionMode::QuickAsk,
            Some("gpt-5-codex"),
            Some("high"),
        );
        assert_eq!(thread["model"], "gpt-5-codex");
        assert_eq!(thread["reasoningEffort"], "high");

        let turn = turn_start(
            "thread",
            "Explain this",
            InteractionMode::QuickAsk,
            Some("gpt-5-codex"),
            Some("high"),
        );
        assert_eq!(turn["model"], "gpt-5-codex");
        assert_eq!(turn["effort"], "high");
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
