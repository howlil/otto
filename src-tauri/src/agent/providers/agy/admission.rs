use super::AGENT_NAME;
use serde_json::Value;

pub(super) struct AdmittedSession {
    pub session_id: String,
    pub image_input: bool,
}

pub(super) fn safe_launch_args(args: &[String]) -> Result<(), String> {
    if args.first().map(String::as_str) != Some("acp") {
        return Err("Agy ACP launch arguments did not target ACP mode.".into());
    }
    let has = |expected: &str| args.iter().any(|arg| arg == expected);
    let has_agent_profile = args
        .windows(2)
        .any(|pair| pair[0] == "--agent" && pair[1] == AGENT_NAME);
    let unsafe_flag = args.iter().any(|arg| {
        arg == "--dangerously-skip-permissions"
            || arg == "--dangerously-skip-permissions=true"
            || arg == "--include-default-customizations"
            || arg == "--include-default-customizations=true"
    });
    if unsafe_flag
        || !has("--stdio")
        || !has_agent_profile
        || !has("--include-default-customizations=false")
        || !has("--dangerously-skip-permissions=false")
        || !has("--sandbox")
    {
        return Err(
            "Agy ACP launch arguments did not enforce Otto's permission-safe sandbox.".into(),
        );
    }
    Ok(())
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

pub(super) fn safe_config_options(config_options: &Value) -> Result<(), String> {
    if config_options.is_null() {
        return Ok(());
    }
    let Some(options) = config_options.as_array() else {
        return Err("Agy returned invalid session configuration options.".into());
    };
    for option in options {
        let is_mode_option =
            option["id"].as_str() == Some("mode") || option["category"].as_str() == Some("mode");
        if is_mode_option && option["currentValue"].as_str() != Some("default") {
            return Err("Agy ACP session did not confirm permission-prompting mode.".into());
        }
    }
    Ok(())
}

pub(super) fn safe_session(result: &Value) -> Result<String, String> {
    let session_id = result["sessionId"]
        .as_str()
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| "Agy did not return a session identity.".to_string())?;
    if result["modes"]["currentModeId"].as_str() != Some("default") {
        return Err("Agy ACP session did not start in permission-prompting default mode.".into());
    }
    if let Some(available) = result["modes"]["availableModes"].as_array()
        && !available
            .iter()
            .any(|mode| mode["id"].as_str() == Some("default"))
    {
        return Err("Agy ACP session did not advertise permission-prompting default mode.".into());
    }
    safe_config_options(&result["configOptions"])?;
    Ok(session_id)
}

pub(super) fn safe_session_update(update: &Value) -> Result<(), String> {
    match update["sessionUpdate"].as_str() {
        Some("tool_call" | "tool_call_update") => {
            Err("Agy attempted an unsupported tool action.".into())
        }
        Some("current_mode_update") if update["currentModeId"].as_str() != Some("default") => {
            Err("Agy switched out of Otto's permission-safe chat mode.".into())
        }
        Some("config_option_update") => safe_config_options(&update["configOptions"]),
        _ => Ok(()),
    }
}

pub(super) fn admit_session(
    launch_args: &[String],
    init_result: &Value,
    session_result: &Value,
) -> Result<AdmittedSession, String> {
    safe_launch_args(launch_args)?;
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

    fn valid_args() -> Vec<String> {
        [
            "acp",
            "--stdio",
            "--agent",
            AGENT_NAME,
            "--include-default-customizations=false",
            "--dangerously-skip-permissions=false",
            "--sandbox",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect()
    }

    fn valid_init(image: bool) -> Value {
        json!({
            "protocolVersion": 1,
            "agentCapabilities": { "promptCapabilities": { "image": image } }
        })
    }

    fn valid_session(mode: &str) -> Value {
        json!({
            "sessionId": "session-1",
            "modes": {
                "currentModeId": mode,
                "availableModes": [
                    { "id": "default", "name": "Default" },
                    { "id": "auto", "name": "Auto" }
                ]
            },
            "configOptions": [
                { "id": "mode", "category": "mode", "currentValue": mode }
            ]
        })
    }

    #[test]
    fn launch_args_require_disabled_skip_permissions_and_sandbox() {
        assert!(safe_launch_args(&valid_args()).is_ok());

        for omitted in [
            "--dangerously-skip-permissions=false",
            "--sandbox",
            "--include-default-customizations=false",
            "--stdio",
        ] {
            let without = valid_args()
                .into_iter()
                .filter(|arg| arg != omitted)
                .collect::<Vec<_>>();
            assert!(safe_launch_args(&without).is_err(), "missing {omitted}");
        }

        let mut auto_approve = valid_args();
        auto_approve.push("--dangerously-skip-permissions".into());
        assert!(safe_launch_args(&auto_approve).is_err());

        let mut explicit_true = valid_args();
        explicit_true.push("--dangerously-skip-permissions=true".into());
        assert!(safe_launch_args(&explicit_true).is_err());
    }

    #[test]
    fn acp_handshake_requires_protocol_capabilities_session_id_and_safe_mode() {
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
        assert!(safe_session(&json!({ "sessionId": "session-1" })).is_err());
        assert!(safe_session(&valid_session("auto")).is_err());
        assert!(safe_session(&valid_session("accept-edits")).is_err());
        assert!(safe_session(&valid_session("plan")).is_err());

        let mut mismatch = valid_session("default");
        mismatch["configOptions"][0]["currentValue"] = json!("auto");
        assert!(safe_session(&mismatch).is_err());

        assert_eq!(
            safe_session(&valid_session("default")).unwrap(),
            "session-1"
        );
    }

    #[test]
    fn admit_session_and_updates_fail_closed_on_unsafe_state() {
        let admitted =
            admit_session(&valid_args(), &valid_init(true), &valid_session("default")).unwrap();
        assert_eq!(admitted.session_id, "session-1");
        assert!(admitted.image_input);

        assert!(admit_session(&[], &valid_init(true), &valid_session("default")).is_err());
        assert!(admit_session(&valid_args(), &valid_init(true), &valid_session("auto")).is_err());

        assert!(
            safe_session_update(&json!({
                "sessionUpdate": "current_mode_update",
                "currentModeId": "default"
            }))
            .is_ok()
        );
        assert!(
            safe_session_update(&json!({
                "sessionUpdate": "current_mode_update",
                "currentModeId": "auto"
            }))
            .is_err()
        );
        assert!(safe_session_update(&json!({
            "sessionUpdate": "config_option_update",
            "configOptions": [{ "id": "mode", "category": "mode", "currentValue": "accept-edits" }]
        }))
        .is_err());
        assert!(
            safe_session_update(&json!({
                "sessionUpdate": "tool_call"
            }))
            .is_err()
        );
    }
}
