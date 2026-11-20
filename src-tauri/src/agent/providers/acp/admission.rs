use serde_json::Value;

pub(super) struct AdmittedSession {
    pub session_id: String,
    pub image_input: bool,
}

pub(super) fn safe_initialize(result: &Value) -> Result<bool, String> {
    if !result["protocolVersion"]
        .as_u64()
        .is_some_and(|version| version >= 1)
        || !result["agentCapabilities"].is_object()
    {
        return Err("Agy ACP server did not confirm protocol capabilities.".into());
    }
    Ok(result["agentCapabilities"]["promptCapabilities"]["image"] == true)
}

pub(super) fn safe_session(result: &Value) -> Result<String, String> {
    result["sessionId"]
        .as_str()
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| "Agy did not return a session identity.".to_string())
}

pub(super) fn admit_session(
    init_result: &Value,
    session_result: &Value,
) -> Result<AdmittedSession, String> {
    let image_input = safe_initialize(init_result)?;
    let session_id = safe_session(session_result)?;
    Ok(AdmittedSession {
        session_id,
        image_input,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn valid_init(image: bool) -> Value {
        json!({
            "protocolVersion": 1,
            "agentCapabilities": { "promptCapabilities": { "image": image } }
        })
    }

    fn valid_session(mode: &str) -> Value {
        json!({
            "sessionId": "session-1",
            "modes": { "currentModeId": mode },
            "configOptions": [
                { "id": "mode", "category": "mode", "currentValue": mode }
            ]
        })
    }

    #[test]
    fn handshake_validates_protocol_capabilities_and_session_identity() {
        assert!(safe_initialize(&json!({})).is_err());
        assert!(
            safe_initialize(&json!({ "protocolVersion": 0, "agentCapabilities": {} })).is_err()
        );
        assert!(
            safe_initialize(&json!({ "protocolVersion": 1, "agentCapabilities": null })).is_err()
        );
        assert!(safe_initialize(&valid_init(true)).unwrap());
        assert!(!safe_initialize(&valid_init(false)).unwrap());
        assert!(safe_session(&json!({})).is_err());
        assert!(safe_session(&json!({ "sessionId": "" })).is_err());
        assert_eq!(safe_session(&valid_session("auto")).unwrap(), "session-1");
    }

    #[test]
    fn session_admission_keeps_native_mode_and_image_capability() {
        let admitted = admit_session(&valid_init(true), &valid_session("auto")).unwrap();
        assert_eq!(admitted.session_id, "session-1");
        assert!(admitted.image_input);
    }
}
