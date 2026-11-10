use super::AGENT_NAME;
use serde_json::Value;

pub(super) fn safe_init(frame: &Value) -> Result<String, String> {
    if frame["event"] != "init" || frame["init"]["agent"] != AGENT_NAME {
        return Err("Agy did not confirm Otto's tool-free agent profile.".into());
    }
    let Some(tools) = frame["init"]["tools"].as_array() else {
        return Err("Agy did not disclose its available tools.".into());
    };
    if frame["init"]["permission_mode"] != "strict" {
        return Err("Agy did not confirm Otto's isolated permission policy.".into());
    }
    if !tools.is_empty() {
        return Err(
            "This Agy version still advertises executable tools for Otto's chat profile.".into(),
        );
    }
    frame["conversation_id"]
        .as_str()
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| "Agy did not return a conversation identity.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn omitted_null_or_wrong_identity_cannot_admit_a_session() {
        let mut frame = json!({"event":"init","conversation_id":"session-1","init":{"tools":[],"permission_mode":"strict"}});
        assert!(safe_init(&frame).is_err());
        frame["init"]["agent"] = Value::Null;
        assert!(safe_init(&frame).is_err());
        frame["init"]["agent"] = json!("default");
        assert!(safe_init(&frame).is_err());
        frame["init"]["agent"] = json!(AGENT_NAME);
        assert_eq!(safe_init(&frame).unwrap(), "session-1");
        frame["init"]["tools"] = json!(["run_command"]);
        assert!(safe_init(&frame).is_err());
    }
}
