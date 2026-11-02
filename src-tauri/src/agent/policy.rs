use serde_json::{Value, json};

pub fn thread_start(cwd: &str, model: Option<&str>, thinking_effort: Option<&str>) -> Value {
    let mut request = json!({
        "cwd": cwd,
        "sandbox": "read-only",
        "approvalPolicy": "never",
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
    model: Option<&str>,
    thinking_effort: Option<&str>,
) -> Value {
    let mut request = json!({
        "threadId": thread_id,
        "input": [{ "type": "text", "text": text }],
        "sandboxPolicy": { "type": "readOnly" },
        "approvalPolicy": "never"
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
    model: Option<&str>,
    thinking_effort: Option<&str>,
    image: Option<&std::path::Path>,
) -> Value {
    let mut request = turn_start(thread_id, text, model, thinking_effort);
    if let Some(path) = image
        && let Some(inputs) = request["input"].as_array_mut()
    {
        inputs.push(json!({ "type": "localImage", "path": path.to_string_lossy() }));
    }
    request
}

pub fn thread_matches_policy(response: &Value) -> bool {
    response.pointer("/sandbox/type").and_then(Value::as_str) == Some("readOnly")
        && response.get("approvalPolicy").and_then(Value::as_str) == Some("never")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn screenshot_is_a_separate_local_image_input_not_part_of_prompt() {
        let image = std::path::Path::new("C:/Users/test/AppData/Local/Temp/otto.png");
        let request = turn_start_with_image("thread", "Analyze this", None, None, Some(image));
        assert_eq!(request["input"][0]["type"], "text");
        assert_eq!(request["input"][1]["type"], "localImage");
        assert_eq!(
            request["input"][1]["path"],
            image.to_string_lossy().as_ref()
        );
        assert_eq!(request["sandboxPolicy"]["type"], "readOnly");
        assert_eq!(
            turn_start_with_image("thread", "Hi", None, None, None),
            turn_start("thread", "Hi", None, None)
        );
    }

    #[test]
    fn chat_policy_denies_writable_or_unknown_policy() {
        assert!(!thread_matches_policy(&json!({ "thread": {} })));
        assert!(!thread_matches_policy(
            &json!({ "sandbox": { "type": "workspaceWrite" }, "approvalPolicy": "never" })
        ));
        assert!(!thread_matches_policy(
            &json!({ "sandbox": { "type": "readOnly" }, "approvalPolicy": "on-request" })
        ));
        assert!(!thread_matches_policy(
            &json!({ "sandbox": { "type": "readOnly" } })
        ));
        assert!(thread_matches_policy(&json!({
            "thread": { "id": "thr" },
            "sandbox": { "type": "readOnly" },
            "approvalPolicy": "never"
        })));
    }

    #[test]
    fn chat_launch_never_enables_writes() {
        let p = thread_start("C:/project", None, None);
        assert_eq!(p["sandbox"], "read-only");
        assert_eq!(p["approvalPolicy"], "never");
        let t = turn_start("t", "explain", None, None);
        assert_eq!(t["sandboxPolicy"]["type"], "readOnly");
        assert_eq!(t["approvalPolicy"], "never");
    }

    #[test]
    fn model_and_thinking_effort_are_forwarded_to_codex_requests() {
        let thread = thread_start("C:/project", Some("gpt-5-codex"), Some("high"));
        assert_eq!(thread["model"], "gpt-5-codex");
        assert_eq!(thread["reasoningEffort"], "high");

        let turn = turn_start("thread", "Explain this", Some("gpt-5-codex"), Some("high"));
        assert_eq!(turn["model"], "gpt-5-codex");
        assert_eq!(turn["effort"], "high");
    }
}
