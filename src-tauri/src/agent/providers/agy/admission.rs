use serde_json::Value;

pub(super) fn safe_initialize(result: &Value) -> Result<bool, String> {
    if result.get("protocolVersion").is_none() || result["agentCapabilities"].is_null() {
        return Err("Agy ACP server did not confirm protocol capabilities.".into());
    }
    Ok(result["agentCapabilities"]["promptCapabilities"]["image"] == true)
}

pub(super) fn safe_session(result: &Value) -> Result<String, String> {
    result["sessionId"]
        .as_str()
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| "Agy did not return a session identity.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn acp_handshake_requires_protocol_capabilities_and_session_id() {
        assert!(safe_initialize(&json!({})).is_err());
        assert!(
            safe_initialize(&json!({
                "protocolVersion": 1,
                "agentCapabilities": { "promptCapabilities": { "image": true } }
            }))
            .unwrap()
        );
        assert!(
            !safe_initialize(&json!({
                "protocolVersion": 1,
                "agentCapabilities": { "promptCapabilities": { "image": false } }
            }))
            .unwrap()
        );
        assert!(safe_session(&json!({})).is_err());
        assert!(safe_session(&json!({ "sessionId": "" })).is_err());
        assert_eq!(
            safe_session(&json!({ "sessionId": "session-1" })).unwrap(),
            "session-1"
        );
    }
}
