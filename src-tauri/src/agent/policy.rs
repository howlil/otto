use serde_json::{json, Value};

pub fn thread_start(cwd: &str) -> Value {
    json!({
        "cwd": cwd,
        "sandbox": "read-only",
        "approvalPolicy": "never",
        "ephemeral": true
    })
}

pub fn turn_start(thread_id: &str, text: &str) -> Value {
    json!({
        "threadId": thread_id,
        "input": [{ "type": "text", "text": text }],
        "sandboxPolicy": { "type": "readOnly", "networkAccess": false },
        "approvalPolicy": "never"
    })
}

// Unknown/missing effective sandbox metadata is not permission to run.
pub fn thread_is_read_only(response: &Value) -> bool {
    let sandbox = response.pointer("/thread/sandbox");
    sandbox.and_then(Value::as_str) == Some("read-only")
        || sandbox.and_then(|v| v.get("type")).and_then(Value::as_str) == Some("readOnly")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quick_ask_denies_writable_or_unknown_policy() {
        assert!(!thread_is_read_only(&json!({ "thread": {} })));
        assert!(!thread_is_read_only(&json!({ "thread": { "sandbox": "workspace-write" } })));
        assert!(thread_is_read_only(&json!({ "thread": { "sandbox": "read-only" } })));
        let p = turn_start("t", "explain");
        assert_eq!(p["sandboxPolicy"]["type"], "readOnly");
        assert_eq!(p["approvalPolicy"], "never");
    }
}
