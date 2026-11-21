mod events;
mod permission;
mod rate_limits;
mod readiness;
mod requests;
mod rpc;
mod turn;

pub(super) use readiness::{executable, probe_rate_limits, readiness};
pub(super) use turn::run;

#[cfg(test)]
use crate::agent::events::ProviderEvents;
#[cfg(test)]
use crate::agent::{CaptureSnapshot, ChatMessage, Snapshot};
#[cfg(test)]
use events::{handle_event, usage_snapshot};
#[cfg(test)]
use readiness::{
    account_read_request, account_readiness, configured_model, configured_runtime, model_readiness,
    model_readiness_with_config,
};
#[cfg(test)]
use rpc::read_frame;
#[cfg(test)]
use serde_json::json;
#[cfg(test)]
use std::time::Duration;
#[cfg(test)]
use tokio::sync::watch;

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::BufReader;

    #[test]
    fn account_read_uses_cached_auth_without_blocking_readiness_on_refresh() {
        assert_eq!(account_read_request(), json!({ "refreshToken": false }));
    }

    #[tokio::test]
    async fn ordinary_rpc_read_has_an_idle_timeout() {
        let (writer, reader) = tokio::io::duplex(256);
        let _keep_writer_open = writer;
        let mut frames = BufReader::new(reader);
        let error = read_frame(&mut frames, Duration::from_millis(5))
            .await
            .unwrap_err();
        assert_eq!(error, "Codex did not respond in time.");
    }

    #[test]
    fn readiness_requires_explicit_account_evidence() {
        assert_eq!(
            account_readiness(&json!({"account": null, "requiresOpenaiAuth": true})).status,
            "authRequired"
        );
        assert_eq!(
            account_readiness(&json!({"account": null, "requiresOpenaiAuth": false})).status,
            "ready"
        );
        assert_eq!(account_readiness(&json!({})).status, "unsupported");
        assert_eq!(
            account_readiness(&json!({"account": {"type": "chatgpt"}})).status,
            "ready"
        );
    }

    #[test]
    fn malformed_codex_config_never_falls_back_to_default() {
        for payload in [
            json!({}),
            json!({ "config": null }),
            json!({ "config": [] }),
            json!({ "config": {} }),
            json!({ "config": { "model": "" } }),
            json!({ "config": { "model": 123 } }),
        ] {
            let status = configured_model(&payload).unwrap_err();
            assert_eq!(status.status, "unsupported");
        }
        assert!(matches!(
            configured_model(&json!({ "config": { "model": null } })),
            Ok(None)
        ));
        assert!(matches!(
            configured_model(&json!({ "config": { "model": "custom" } })),
            Ok(Some("custom"))
        ));
    }

    #[test]
    fn model_capability_is_gated_by_the_default_model() {
        let ready = model_readiness(
            &json!({ "data": [
                { "isDefault": true, "inputModalities": ["text", "image"] }
            ] }),
            None,
        );
        assert_eq!(ready.status, "ready");
        assert!(ready.image_input);

        for invalid in [
            json!({}),
            json!({ "data": [] }),
            json!({ "data": [{ "isDefault": true, "inputModalities": ["image"] }] }),
            json!({ "data": [{ "isDefault": true, "inputModalities": "text" }] }),
        ] {
            assert_ne!(model_readiness(&invalid, None).status, "ready");
        }
    }

    #[test]
    fn model_capability_is_gated_by_the_requested_model() {
        let ready = model_readiness(
            &json!({
                "data": [
                    { "id": "text", "isDefault": true, "inputModalities": ["text"] },
                    { "id": "vision", "inputModalities": ["text", "image"] }
                ]
            }),
            Some("vision"),
        );
        assert_eq!(ready.status, "ready");
        assert_eq!(ready.model.as_deref(), Some("vision"));
        assert!(ready.image_input);
    }

    #[test]
    fn model_catalog_exposes_selection_and_thinking_capabilities() {
        let ready = model_readiness(
            &json!({ "data": [{
                "id": "gpt-5-codex",
                "model": "gpt-5-codex",
                "displayName": "GPT-5 Codex",
                "isDefault": true,
                "inputModalities": ["text", "image"],
                "supportedReasoningEfforts": [
                    { "reasoningEffort": "medium" },
                    { "reasoningEffort": "high" }
                ],
                "defaultReasoningEffort": "medium"
            }] }),
            None,
        );
        assert_eq!(ready.model.as_deref(), Some("gpt-5-codex"));
        assert_eq!(ready.thinking_effort.as_deref(), Some("medium"));
        assert_eq!(ready.thinking_efforts, ["medium", "high"]);
        assert_eq!(ready.models.len(), 1);
    }

    #[test]
    fn provider_usage_notification_maps_context_and_session_totals() {
        let usage = usage_snapshot(&json!({
            "params": {
                "tokenUsage": {
                    "last": {
                        "inputTokens": 120,
                        "cachedInputTokens": 40,
                        "outputTokens": 80,
                        "reasoningOutputTokens": 20,
                        "totalTokens": 200
                    },
                    "total": {
                        "inputTokens": 120,
                        "cachedInputTokens": 40,
                        "outputTokens": 80,
                        "totalTokens": 200
                    },
                    "modelContextWindow": 4000
                }
            }
        }))
        .expect("valid usage notification");
        assert_eq!(usage.context_tokens, Some(200));
        assert_eq!(usage.session_tokens, 200);
        assert_eq!(usage.cached_input_tokens, 40);
        assert_eq!(usage.model_context_window, Some(4000));
    }

    fn snapshot(status: &str, run_id: u64) -> watch::Sender<Snapshot> {
        let (tx, _) = watch::channel(Snapshot {
            run_id,
            seq: 1,
            status: status.into(),
            provider: "codex".into(),
            cwd: String::new(),
            conversation_id: String::new(),
            thread_id: None,
            model: None,
            thinking_effort: None,
            usage: None,
            rate_limits: Vec::new(),
            messages: vec![ChatMessage {
                id: "test:assistant".into(),
                role: "assistant".into(),
                text: String::new(),
            }],
            activity: Vec::new(),
            capture: CaptureSnapshot::default(),
            queued_followup: None,
            pending_permission: None,
            turn_timing: None,
            error: None,
        });
        tx
    }

    #[test]
    fn unrelated_turn_cannot_append_output() {
        let tx = snapshot("streaming", 5);
        handle_event(
            &json!({
                "method": "item/agentMessage/delta",
                "params": { "threadId": "other", "turnId": "turn", "delta": "bad" }
            }),
            "real",
            "turn",
            5,
            &ProviderEvents::new(tx.clone()),
        );
        assert!(tx.borrow().messages[0].text.is_empty());
    }

    #[test]
    fn user_message_items_are_chat_events_not_tool_actions() {
        let tx = snapshot("streaming", 4);
        let updates = ProviderEvents::new(tx.clone());
        assert!(!handle_event(
            &json!({
                "method": "item/started",
                "params": { "threadId": "thread", "turnId": "turn",
                    "item": { "type": "userMessage", "content": [] } }
            }),
            "thread",
            "turn",
            4,
            &updates,
        ));
        assert!(!handle_event(
            &json!({
                "method": "item/completed",
                "params": { "threadId": "thread", "turnId": "turn",
                    "item": { "type": "userMessage", "content": [] } }
            }),
            "thread",
            "turn",
            4,
            &updates,
        ));
        assert_eq!(tx.borrow().status, "streaming");
        assert!(tx.borrow().error.is_none());
    }

    #[test]
    fn provider_tool_items_are_not_filtered_by_otto() {
        let tx = snapshot("streaming", 3);
        assert!(!handle_event(
            &json!({
                "method": "item/started",
                "params": { "threadId": "thread", "turnId": "turn",
                    "item": { "type": "commandExecution", "command": "cargo test" } }
            }),
            "thread",
            "turn",
            3,
            &ProviderEvents::new(tx.clone()),
        ));
        assert_eq!(tx.borrow().status, "streaming");
        assert!(tx.borrow().error.is_none());
    }

    #[test]
    fn expired_auth_turn_reports_sign_in_instead_of_generic_failure() {
        let tx = snapshot("streaming", 9);
        let failed = json!({
            "method": "turn/completed",
            "params": { "threadId": "thread", "turn": { "id": "turn", "status": "failed",
                "error": { "message": "401 Unauthorized: token expired, please log in again" } } }
        });
        assert!(handle_event(
            &failed,
            "thread",
            "turn",
            9,
            &ProviderEvents::new(tx.clone())
        ));
        assert_eq!(tx.borrow().status, "failed");
        let error = tx.borrow().error.clone().unwrap_or_default();
        assert!(
            error.contains("Sign in"),
            "auth expiry must offer sign-in recovery, got {error:?}"
        );
    }

    #[test]
    fn turn_failure_without_auth_detail_stays_generic() {
        let tx = snapshot("streaming", 11);
        let failed = json!({
            "method": "turn/completed",
            "params": { "threadId": "thread", "turn": { "id": "turn", "status": "failed" } }
        });
        assert!(handle_event(
            &failed,
            "thread",
            "turn",
            11,
            &ProviderEvents::new(tx.clone())
        ));
        assert_eq!(tx.borrow().status, "failed");
        assert_eq!(
            tx.borrow().error.as_deref(),
            Some("Codex turn did not complete.")
        );
    }

    #[test]
    fn interrupted_turn_is_stopped() {
        let tx = snapshot("streaming", 7);
        let interrupted = json!({
            "method": "turn/completed",
            "params": { "threadId": "thread", "turn": { "id": "turn", "status": "interrupted" } }
        });
        assert!(handle_event(
            &interrupted,
            "thread",
            "turn",
            7,
            &ProviderEvents::new(tx.clone())
        ));
        assert_eq!(tx.borrow().status, "stopped");
    }

    #[test]
    fn model_readiness_honors_native_config_effort_window_and_filters_hidden_models() {
        let config = json!({
            "config": {
                "model": "gpt-5.6-sol",
                "model_reasoning_effort": "high",
                "model_context_window": 400000
            }
        });
        let Ok(runtime) = configured_runtime(&config) else {
            panic!("expected valid configured runtime");
        };
        assert_eq!(runtime.model, Some("gpt-5.6-sol"));
        assert_eq!(runtime.reasoning_effort, Some("high"));
        assert_eq!(runtime.context_window, Some(400_000));

        let ready = model_readiness_with_config(
            &json!({
                "data": [
                    {
                        "id": "gpt-5.6-sol",
                        "displayName": "GPT-5.6-Sol",
                        "isDefault": true,
                        "hidden": false,
                        "inputModalities": ["text", "image"],
                        "supportedReasoningEfforts": [
                            { "reasoningEffort": "low" },
                            { "reasoningEffort": "high" }
                        ],
                        "defaultReasoningEffort": "low"
                    },
                    {
                        "id": "internal-hidden",
                        "displayName": "Internal",
                        "hidden": true,
                        "inputModalities": ["text"]
                    }
                ]
            }),
            runtime.model,
            runtime.reasoning_effort,
            runtime.context_window,
        );
        assert_eq!(ready.thinking_effort.as_deref(), Some("high"));
        assert_eq!(ready.models.len(), 1);
        assert_eq!(ready.models[0].context_window, Some(400_000));
        assert_eq!(
            ready.models[0].default_thinking_effort.as_deref(),
            Some("high")
        );
    }

    #[test]
    fn codex_rate_limits_updated_notification_updates_snapshot_without_turn_ids() {
        let tx = snapshot("streaming", 14);
        let updates = ProviderEvents::new(tx.clone());
        let event = json!({
            "method": "account/rateLimits/updated",
            "params": {
                "rateLimits": {
                    "limitId": "codex",
                    "primary": { "usedPercent": 42, "windowDurationMins": 300, "resetsAt": 1_792_100_000 },
                    "secondary": { "usedPercent": 15, "windowDurationMins": 10080 }
                }
            }
        });
        assert!(!handle_event(&event, "thread", "turn", 14, &updates));
        let limits = &tx.borrow().rate_limits;
        assert_eq!(limits.len(), 2);
        assert_eq!(limits[0].window, "5h");
        assert_eq!(limits[0].used_percent, 42);
        assert_eq!(limits[1].window, "weekly");
        assert_eq!(limits[1].used_percent, 15);
    }
}
