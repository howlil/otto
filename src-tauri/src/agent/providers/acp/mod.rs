mod admission;
mod agy_limits;
mod client;
mod observe;
mod permission;
mod readiness;
mod spec;
mod turn;
mod wire;

pub(super) use client::executable;
pub(super) use readiness::readiness;
pub(super) use turn::run;

pub(super) async fn probe_rate_limits(
    spec: &'static spec::AcpSpec,
    cwd: &std::path::Path,
) -> Vec<crate::agent::ProviderRateLimit> {
    if spec.name != "Agy" {
        return Vec::new();
    }
    let Some(binary) = executable(spec) else {
        return Vec::new();
    };
    agy_limits::probe_agy_rate_limits(cwd, &binary).await
}

#[cfg(test)]
use crate::agent::ProviderId;
#[cfg(test)]
use crate::agent::events::ProviderEvents;
#[cfg(test)]
use crate::agent::{CaptureSnapshot, CapturedImage, Snapshot};
#[cfg(test)]
use admission::admit_session;
#[cfg(test)]
use client::{AcpClient, STARTUP_TIMEOUT};
#[cfg(test)]
use observe::{TurnState, observe_acp};
#[cfg(test)]
use readiness::{model_catalog, thinking_config};
#[cfg(test)]
use serde_json::json;
#[cfg(test)]
use tokio::sync::watch;
#[cfg(test)]
use wire::prompt_params;

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires installed Agy; reports capability names only"]
    async fn installed_agy_admission_matches_the_real_cli() {
        let mut client =
            AcpClient::launch(ProviderId::Agy.acp_spec().unwrap(), &std::env::temp_dir()).unwrap();
        let (init_result, _) = client
            .request(
                "initialize",
                json!({ "protocolVersion": 1, "clientCapabilities": {} }),
                STARTUP_TIMEOUT,
            )
            .await
            .unwrap();
        let (session_result, context_window) = client
            .request(
                "session/new",
                json!({ "cwd": std::env::temp_dir().to_string_lossy() }),
                STARTUP_TIMEOUT,
            )
            .await
            .unwrap();
        let admitted = admit_session(&init_result, &session_result).unwrap();
        client.terminate().await;
        let models = model_catalog(&session_result, admitted.image_input, context_window);
        println!(
            "Agy ACP session: {}; image: {}; models: {}",
            admitted.session_id,
            admitted.image_input,
            models.len()
        );
        assert!(!models.is_empty());
    }

    #[test]
    fn acp_model_catalog_maps_models_and_image_capability() {
        let models = model_catalog(
            &json!({
                "models": {
                    "currentModelId": "gemini-4-argon-medium",
                    "availableModels": [
                        { "modelId": "gemini-4-argon-medium", "name": "Gemini 4 Argon (Medium)" },
                        { "modelId": "gemini-3.8-flash-low", "name": "Gemini 3.8 Flash (Low)" },
                        { "modelId": "" }
                    ]
                }
            }),
            true,
            Some(1_048_576),
        );
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "gemini-4-argon-medium");
        assert_eq!(models[0].display_name, "Gemini 4 Argon (Medium)");
        assert!(models[0].image_input);
        assert_eq!(models[0].context_window, Some(1_048_576));
    }

    #[test]
    fn acp_config_options_drive_dynamic_models_over_legacy_flat_variants() {
        let session = json!({
            "sessionId": "session-2",
            "models": {
                "currentModelId": "gemini-4-neon-high",
                "availableModels": [
                    { "modelId": "gemini-4-neon-high", "name": "Gemini 4 Neon (High)" },
                    { "modelId": "gemini-4-neon-low", "name": "Gemini 4 Neon (Low)" }
                ]
            },
            "configOptions": [
                {
                    "id": "model",
                    "category": "model",
                    "type": "select",
                    "currentValue": "gemini-4-neon",
                    "options": [
                        { "value": "gemini-4-neon", "name": "Gemini 4 Neon" },
                        { "value": "gemini-pro-orchestrator-neon", "name": "Orchestrator (Neon)" }
                    ]
                },
                {
                    "id": "thought_level",
                    "category": "thought_level",
                    "type": "select",
                    "currentValue": "high",
                    "options": [
                        { "value": "low", "name": "Low" },
                        { "value": "high", "name": "High" }
                    ]
                }
            ]
        });
        let models = model_catalog(&session, true, Some(1_048_576));
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "gemini-4-neon");
        assert_eq!(models[0].display_name, "Gemini 4 Neon");
        assert_eq!(models[1].id, "gemini-pro-orchestrator-neon");
        let thinking = thinking_config(&session).expect("thinking config present");
        assert_eq!(thinking.config_id, "thought_level");
        assert_eq!(thinking.current.as_deref(), Some("high"));
        assert_eq!(thinking.options, ["low", "high"]);
        assert!(
            thinking_config(&json!({
                "configOptions": [
                    { "id": "model", "category": "model", "currentValue": "gemini-pro-orchestrator-neon" }
                ]
            }))
            .is_none()
        );
    }

    #[tokio::test]
    async fn acp_prompt_params_encode_png_capture_as_image_block() {
        let path =
            std::env::temp_dir().join(format!("otto-agy-capture-{}.png", std::process::id()));
        let mut encoder = png::Encoder::new(std::fs::File::create(&path).unwrap(), 1, 1);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&[255, 0, 0, 255]).unwrap();
        drop(writer);

        let capture = CapturedImage::new(path.clone());
        let params = prompt_params("session-1", "Describe this", Some(&capture))
            .await
            .unwrap();
        let _ = std::fs::remove_file(&path);
        assert_eq!(params["sessionId"], "session-1");
        assert_eq!(params["prompt"][0]["type"], "text");
        assert_eq!(params["prompt"][0]["text"], "Describe this");
        assert_eq!(params["prompt"][1]["type"], "image");
        assert_eq!(params["prompt"][1]["mimeType"], "image/png");
        assert!(!params["prompt"][1]["data"].as_str().unwrap().is_empty());
    }

    #[test]
    fn acp_usage_update_emits_context_usage_before_result() {
        let (tx, _) = watch::channel(Snapshot {
            run_id: 8,
            seq: 0,
            status: "starting".into(),
            provider: "agy".into(),
            cwd: String::new(),
            conversation_id: String::new(),
            thread_id: None,
            model: None,
            thinking_effort: None,
            usage: None,
            rate_limits: Vec::new(),
            messages: vec![],
            activity: Vec::new(),
            capture: CaptureSnapshot::default(),
            queued_followup: None,
            pending_permission: None,
            turn_timing: None,
            error: None,
        });
        let events = ProviderEvents::new(tx.clone());
        let mut turn = TurnState::new("Agy", 8, 3, "Hello", Some(1_048_576));
        assert!(!observe_acp(
            &json!({
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "update": {
                        "sessionUpdate": "usage_update",
                        "used": 5000,
                        "size": 1_048_576
                    }
                }
            }),
            &mut turn,
            &events
        ));
        let usage = tx.borrow().usage.clone().expect("live context usage");
        assert_eq!(usage.context_tokens, Some(5000));
        assert_eq!(usage.model_context_window, Some(1_048_576));
    }

    #[test]
    fn acp_observer_streams_text_tracks_usage_and_keeps_native_tools() {
        let (tx, _) = watch::channel(Snapshot {
            run_id: 8,
            seq: 0,
            status: "starting".into(),
            provider: "agy".into(),
            cwd: String::new(),
            conversation_id: String::new(),
            thread_id: None,
            model: None,
            thinking_effort: None,
            usage: None,
            rate_limits: Vec::new(),
            messages: vec![],
            activity: Vec::new(),
            capture: CaptureSnapshot::default(),
            queued_followup: None,
            pending_permission: None,
            turn_timing: None,
            error: None,
        });
        let events = ProviderEvents::new(tx.clone());
        let mut turn = TurnState::new("Agy", 8, 3, "Hello", Some(1_048_576));

        assert!(!observe_acp(
            &json!({
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "update": {
                        "sessionUpdate": "usage_update",
                        "used": 6767,
                        "size": 1_048_576
                    }
                }
            }),
            &mut turn,
            &events
        ));
        assert!(!observe_acp(
            &json!({
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "update": {
                        "sessionUpdate": "user_message_chunk",
                        "content": { "type": "text", "text": "Hello" }
                    }
                }
            }),
            &mut turn,
            &events
        ));
        assert!(!observe_acp(
            &json!({
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "update": {
                        "sessionUpdate": "agent_message_chunk",
                        "content": { "type": "text", "text": "Red" }
                    }
                }
            }),
            &mut turn,
            &events
        ));
        assert!(observe_acp(
            &json!({
                "jsonrpc": "2.0",
                "id": 3,
                "result": {
                    "stopReason": "end_turn",
                    "usage": {
                        "inputTokens": 6762,
                        "outputTokens": 5,
                        "cachedReadTokens": 100,
                        "thoughtTokens": 2,
                        "totalTokens": 6767
                    }
                }
            }),
            &mut turn,
            &events
        ));
        let snap = tx.borrow();
        assert_eq!(snap.status, "completed");
        assert_eq!(snap.messages.last().unwrap().text, "Red");
        let usage = snap.usage.as_ref().unwrap();
        assert_eq!(usage.session_tokens, 6767);
        assert_eq!(usage.context_tokens, Some(6767));
        assert_eq!(usage.model_context_window, Some(1_048_576));

        let (tool_tx, _) = watch::channel(Snapshot {
            run_id: 9,
            seq: 0,
            status: "streaming".into(),
            provider: "agy".into(),
            cwd: String::new(),
            conversation_id: String::new(),
            thread_id: None,
            model: None,
            thinking_effort: None,
            usage: None,
            rate_limits: Vec::new(),
            messages: vec![],
            activity: Vec::new(),
            capture: CaptureSnapshot::default(),
            queued_followup: None,
            pending_permission: None,
            turn_timing: None,
            error: None,
        });
        let tool_events = ProviderEvents::new(tool_tx.clone());
        let mut tool_turn = TurnState::new("Agy", 9, 4, "Run", None);
        assert!(!observe_acp(
            &json!({
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": { "update": { "sessionUpdate": "tool_call", "title": "run_command" } }
            }),
            &mut tool_turn,
            &tool_events
        ));
        assert_eq!(tool_tx.borrow().status, "streaming");

        let (perm_tx, _) = watch::channel(Snapshot {
            run_id: 10,
            seq: 0,
            status: "streaming".into(),
            provider: "agy".into(),
            cwd: String::new(),
            conversation_id: String::new(),
            thread_id: None,
            model: None,
            thinking_effort: None,
            usage: None,
            rate_limits: Vec::new(),
            messages: vec![],
            activity: Vec::new(),
            capture: CaptureSnapshot::default(),
            queued_followup: None,
            pending_permission: None,
            turn_timing: None,
            error: None,
        });
        let perm_events = ProviderEvents::new(perm_tx.clone());
        let mut perm_turn = TurnState::new("Agy", 10, 5, "Perm", None);
        assert!(observe_acp(
            &json!({
                "jsonrpc": "2.0",
                "id": 99,
                "method": "session/request_permission",
                "params": {}
            }),
            &mut perm_turn,
            &perm_events
        ));
        assert_eq!(perm_tx.borrow().status, "failed");

        let (mode_tx, _) = watch::channel(Snapshot {
            run_id: 11,
            seq: 0,
            status: "streaming".into(),
            provider: "agy".into(),
            cwd: String::new(),
            conversation_id: String::new(),
            thread_id: None,
            model: None,
            thinking_effort: None,
            usage: None,
            rate_limits: Vec::new(),
            messages: vec![],
            activity: Vec::new(),
            capture: CaptureSnapshot::default(),
            queued_followup: None,
            pending_permission: None,
            turn_timing: None,
            error: None,
        });
        let mode_events = ProviderEvents::new(mode_tx.clone());
        let mut mode_turn = TurnState::new("Agy", 11, 6, "Mode", None);
        assert!(!observe_acp(
            &json!({
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": { "update": { "sessionUpdate": "current_mode_update", "currentModeId": "auto" } }
            }),
            &mut mode_turn,
            &mode_events
        ));
        assert_eq!(mode_tx.borrow().status, "streaming");
    }
}
