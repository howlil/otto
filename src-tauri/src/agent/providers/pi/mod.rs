mod cancellation;
mod events;
mod readiness;
mod rpc;
mod turn;

pub(super) use readiness::{executable, readiness};
pub(super) use turn::run;

#[cfg(test)]
use crate::agent::events::ProviderEvents;
#[cfg(test)]
use crate::agent::{CaptureSnapshot, CapturedImage, ChatMessage, Control, Snapshot};
#[cfg(test)]
use base64::{Engine as _, engine::general_purpose::STANDARD};
#[cfg(test)]
use cancellation::{Controlled, await_controlled};
#[cfg(test)]
use events::TurnObserver;
#[cfg(test)]
use readiness::{
    AUTH_PROBE_TIMEOUT, READINESS_RPC_TIMEOUT, authentication, failure_readiness, model_option,
    usage_snapshot, valid_pi_model_id,
};
#[cfg(test)]
use rpc::{
    REQUEST_TIMEOUT, STARTUP_REQUEST_TIMEOUT, available_models, launch_args, model_accepts_images,
    model_identity, protocol_parse_error, request_timeout, thinking_levels,
};
#[cfg(test)]
use serde_json::json;
#[cfg(test)]
use tokio::sync::{mpsc, watch};
#[cfg(test)]
use turn::{accepted_prompt, prompt_command};

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> watch::Sender<Snapshot> {
        let (tx, _) = watch::channel(Snapshot {
            run_id: 7,
            seq: 0,
            status: "streaming".into(),
            provider: "pi".into(),
            conversation_id: String::new(),
            cwd: String::new(),
            thread_id: None,
            model: None,
            thinking_effort: None,
            usage: None,
            rate_limits: Vec::new(),
            messages: vec![ChatMessage {
                id: "7:assistant".into(),
                role: "assistant".into(),
                text: String::new(),
            }],
            activity: Vec::new(),
            capture: CaptureSnapshot::default(),
            queued_followup: None,
            pending_permission: None,
            error: None,
        });
        tx
    }

    #[tokio::test]
    async fn pi_screenshot_prompt_transports_real_png_pixels_and_deletes_temp() {
        let path = std::env::temp_dir().join(format!(
            "otto-pi-image-{}-{}.png",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            let output = std::fs::File::create(&path).unwrap();
            let mut encoder = png::Encoder::new(output, 1, 1);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(&[20, 30, 40, 255]).unwrap();
        }
        let capture = CapturedImage::new(path.clone());
        let expected = STANDARD.encode(std::fs::read(&path).unwrap());
        let command = prompt_command(7, "What is on screen?", Some(&capture))
            .await
            .unwrap();
        assert_eq!(command["type"], "prompt");
        assert_eq!(command["id"], "otto-7");
        assert_eq!(command["message"], "What is on screen?");
        assert_eq!(command["images"][0]["type"], "image");
        assert_eq!(command["images"][0]["mimeType"], "image/png");
        assert_eq!(command["images"][0]["data"], expected);
        assert!(
            !command
                .to_string()
                .contains(path.to_string_lossy().as_ref())
        );
        drop(capture);
        assert!(!path.exists());
    }

    #[tokio::test]
    async fn pi_text_only_and_invalid_png_never_fake_image_payload() {
        let text = prompt_command(8, "Hello", None).await.unwrap();
        assert!(text.get("images").is_none());
        let path = std::env::temp_dir().join(format!("otto-pi-invalid-{}.png", std::process::id()));
        std::fs::write(&path, b"this is not a png").unwrap();
        let capture = CapturedImage::new(path);
        assert!(
            prompt_command(9, "Analyze this", Some(&capture))
                .await
                .is_err()
        );
    }

    #[test]
    fn pi_image_readiness_requires_selected_model_capability() {
        assert!(model_accepts_images(
            &json!({"model":{"provider":"openai","id":"vision","input":["text","image"]}})
        ));
        assert!(!model_accepts_images(
            &json!({"model":{"provider":"openai","id":"text-only","input":["text"]}})
        ));
        assert!(!model_accepts_images(&json!({"model":{"input":"image"}})));
        assert!(!model_accepts_images(&json!({})));
    }

    #[test]
    fn pi_rpc_keeps_native_tool_and_session_settings() {
        assert_eq!(launch_args(), &["--mode", "rpc"]);
    }

    #[test]
    fn pi_only_finishes_on_settled_and_rejects_stale_events() {
        let tx = state();
        let events = ProviderEvents::new(tx.clone());
        let mut observer = TurnObserver::default();
        assert!(!observer.observe(&json!({"type":"agent_end"}), 7, &events));
        observer.observe(
            &json!({"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"partial"}}),
            7,
            &events,
        );
        assert_eq!(tx.borrow().messages[0].text, "partial");
        observer.observe(
            &json!({"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"final"}]}}),
            7,
            &events,
        );
        assert_eq!(tx.borrow().messages[0].text, "final");
        assert!(!observer.observe(&json!({"type":"agent_settled"}), 6, &events));
        assert!(observer.observe(&json!({"type":"agent_settled"}), 7, &events));
        assert_eq!(tx.borrow().status, "completed");
        observer.observe(
            &json!({"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"late"}}),
            7,
            &events,
        );
        assert_eq!(tx.borrow().messages[0].text, "final");
    }

    #[test]
    fn pi_failed_or_empty_answer_never_looks_completed() {
        let tx = state();
        let events = ProviderEvents::new(tx.clone());
        let mut observer = TurnObserver::default();
        assert!(!observer.observe(
            &json!({"type":"message_end","message":{"role":"assistant","stopReason":"error","content":[{"type":"text","text":"partial"}]}}),
            7,
            &events,
        ));
        assert_eq!(tx.borrow().status, "streaming");
        assert!(tx.borrow().messages[0].text.is_empty());
        assert!(observer.observe(&json!({"type":"agent_settled","aborted":false}), 7, &events));
        assert_eq!(tx.borrow().status, "failed");

        let empty = state();
        let empty_events = ProviderEvents::new(empty.clone());
        assert!(TurnObserver::default().observe(
            &json!({"type":"agent_settled","aborted":false}),
            7,
            &empty_events
        ));
        assert_eq!(empty.borrow().status, "failed");
        assert_eq!(
            empty.borrow().error.as_deref(),
            Some("Pi finished without an answer.")
        );

        let aborted = state();
        let aborted_events = ProviderEvents::new(aborted.clone());
        assert!(TurnObserver::default().observe(
            &json!({"type":"agent_settled","aborted":true}),
            7,
            &aborted_events
        ));
        assert_eq!(aborted.borrow().status, "failed");
    }

    #[test]
    fn pi_catalog_preserves_provider_and_slashes_in_model_ids() {
        let catalog = json!({"models":[
            {
                "provider":"netra",
                "id":"deepseek/deepseek-v4.1-flash",
                "name":"DeepSeek",
                "input":["text"],
                "reasoning":true,
                "contextWindow":1000000
            },
            {
                "provider":"opencode-go",
                "id":"gpt-6-luna",
                "input":["text","image"],
                "reasoning":true,
                "contextWindow":1100000
            },
            {
                "provider":"other",
                "id":"image-only",
                "input":["image"]
            }
        ]});
        let models = available_models(&catalog).unwrap();
        assert_eq!(models.len(), 2);
        let first = model_option(&models[0]).unwrap();
        assert_eq!(first.id, "netra/deepseek/deepseek-v4.1-flash");
        assert_eq!(first.context_window, Some(1000000));
        assert!(!first.image_input);
        let other = model_option(&models[1]).unwrap();
        assert_eq!(other.id, "opencode-go/gpt-6-luna");
        assert!(other.image_input);
        assert!(available_models(&json!({"models":[]})).is_err());
    }

    #[test]
    fn pi_thinking_levels_come_from_runtime_not_model_guesses() {
        assert_eq!(
            thinking_levels(&json!({"levels":["off"]})).unwrap(),
            vec!["off"]
        );
        assert_eq!(
            thinking_levels(&json!({"levels":["off","low","high","max","ultra"]})).unwrap(),
            vec!["off", "low", "high", "max", "ultra"]
        );
        assert!(thinking_levels(&json!({"levels":[]})).unwrap().is_empty());
        assert!(thinking_levels(&json!({"levels":["bad level"]})).is_err());
        assert!(thinking_levels(&json!({"levels":["x&y"]})).is_err());
    }

    #[test]
    fn pi_usage_preserves_unknown_context_after_compaction() {
        let usage = usage_snapshot(&json!({
            "tokens": {
                "input":50000,
                "output":10000,
                "cacheRead":40000,
                "cacheWrite":5000,
                "total":105000
            },
            "contextUsage": {
                "tokens":null,
                "contextWindow":200000,
                "percent":null
            }
        }))
        .unwrap();
        assert_eq!(usage.context_tokens, None);
        assert_eq!(usage.model_context_window, Some(200000));
        assert_eq!(usage.session_tokens, 105000);
        assert_eq!(usage.cached_input_tokens, 40000);
        assert_eq!(usage.reasoning_output_tokens, None);
        assert!(usage_snapshot(&json!({"tokens":{"input":7}})).is_none());
    }

    #[tokio::test]
    async fn stop_interrupts_an_unresponsive_pi_setup_before_prompt() {
        let snapshot = state();
        let (sender, mut controls) = mpsc::channel(1);
        sender.send(Control::Stop).await.unwrap();
        let result = await_controlled(&mut controls, std::future::pending::<Result<(), String>>())
            .await
            .unwrap();
        assert!(matches!(result, Controlled::Cancelled(None)));
        assert_eq!(snapshot.borrow().status, "streaming");
    }

    #[tokio::test]
    async fn close_acknowledges_during_await_controlled() {
        let (sender, mut controls) = mpsc::channel(1);
        let claimed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let (finished, rx) = tokio::sync::oneshot::channel();
        sender
            .send(Control::Close { claimed, finished })
            .await
            .unwrap();
        let result = await_controlled(&mut controls, std::future::pending::<Result<(), String>>())
            .await
            .unwrap();
        let Controlled::Cancelled(Some(ack)) = result else {
            panic!("close acknowledgment channel expected");
        };
        assert!(ack.send(()).is_ok());
        rx.await.unwrap();
    }

    #[test]
    fn malformed_pi_rpc_frame_is_reported_without_waiting_for_request_timeout() {
        assert!(protocol_parse_error(&json!({
            "type":"response",
            "command":"parse",
            "success":false,
            "error":"Invalid JSON"
        })));
        assert!(!protocol_parse_error(&json!({
            "type":"response",
            "command":"get_state",
            "success":false
        })));
    }

    #[test]
    fn pi_prompt_ack_auth_and_model_gates_fail_closed() {
        assert!(
            accepted_prompt(
                &json!({"type":"response","id":"otto-7","command":"prompt","success":true}),
                7
            )
            .unwrap()
        );
        assert!(
            accepted_prompt(
                &json!({"type":"response","id":"otto-7","command":"prompt",
            "success":true,"data":{"disposition":"started"}}),
                7
            )
            .unwrap()
        );
        assert!(
            accepted_prompt(
                &json!({"type":"response","id":"otto-7","command":"prompt",
            "success":true,"data":{"disposition":"queued"}}),
                7
            )
            .is_err()
        );
        assert_eq!(
            authentication(&json!({"status":"not_ready"})).status,
            "authRequired"
        );
        let invalid = authentication(&json!({"status":"invalid"}));
        assert_eq!(invalid.status, "unavailable");
        assert!(invalid.message.contains("verify the selected model"));
        assert!(invalid.recovery.contains("provider sign-in"));
        assert_eq!(
            authentication(&json!({"status":"unknown"})).status,
            "unsupported"
        );
        assert!(
            model_identity(&json!({"model":{"provider":"openai","id":"gpt-6","input":["text"]}}))
                .is_some()
        );
        assert!(
            model_identity(&json!({"model":{"provider":"openai","id":"gpt-6","input":["image"]}}))
                .is_none()
        );
    }

    #[test]
    fn pi_model_id_validator_rejects_batch_metacharacters() {
        assert!(valid_pi_model_id("openai/gpt-5.4"));
        assert!(valid_pi_model_id(
            "openrouter/anthropic/claude-sonnet-4:free"
        ));
        assert!(!valid_pi_model_id(""));
        assert!(!valid_pi_model_id("--exec=whoami"));
        assert!(!valid_pi_model_id("openai/gpt&whoami"));
        assert!(!valid_pi_model_id("openai/gpt|dir"));
        assert!(!valid_pi_model_id("openai/gpt %PATH%"));
        assert!(!valid_pi_model_id("openai/gpt^calc"));
        assert!(!valid_pi_model_id("openai/gpt\necho"));
    }

    #[test]
    fn pi_usage_snapshot_allows_omitted_cache_read() {
        let usage = usage_snapshot(&json!({
            "tokens": {
                "input": 120,
                "output": 30,
                "total": 150
            },
            "contextUsage": {
                "tokens": 120,
                "contextWindow": 200000
            }
        }))
        .unwrap();
        assert_eq!(usage.input_tokens, 120);
        assert_eq!(usage.output_tokens, 30);
        assert_eq!(usage.cached_input_tokens, 0);
        assert_eq!(usage.session_tokens, 150);
    }

    #[test]
    fn pi_timeouts_and_failure_readiness_accommodate_extension_startup_and_preserve_catalog() {
        assert_eq!(request_timeout(false), STARTUP_REQUEST_TIMEOUT);
        assert_eq!(request_timeout(true), REQUEST_TIMEOUT);
        assert!(STARTUP_REQUEST_TIMEOUT >= std::time::Duration::from_secs(45));
        assert!(READINESS_RPC_TIMEOUT > STARTUP_REQUEST_TIMEOUT);
        assert!(AUTH_PROBE_TIMEOUT >= std::time::Duration::from_secs(20));
        let discovered = vec![
            model_option(&json!({
                "provider": "opencode-go",
                "id": "kimi-k2.7-code",
                "name": "Kimi K2.7 Code",
                "input": ["text", "image"]
            }))
            .unwrap(),
        ];
        let timed_out = failure_readiness(discovered.clone(), true);
        assert_eq!(timed_out.status, "unavailable");
        assert!(timed_out.message.contains("timed out"));
        assert_eq!(timed_out.models.len(), 1);
        let failed = failure_readiness(discovered, false);
        assert_eq!(failed.status, "unsupported");
        assert_eq!(failed.models.len(), 1);
    }
}
