use crate::agent::activity::{describe_thinking, describe_tool};
use crate::agent::events::{AgentEvent, ProviderEvents};
use crate::agent::providers::authentication_required;
use crate::agent::providers::rate_limits::{
    normalize_fraction_percent, normalize_percent, normalize_reset_at, window_from_type,
};
use crate::agent::{ActivityDetails, ActivityKind, ProviderRateLimit, UsageSnapshot};
use serde_json::Value;
use std::time::Duration;

pub(super) const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;
pub(super) const MAX_ANSWER_BYTES: usize = 2 * 1024 * 1024;
pub(super) const TURN_IDLE_TIMEOUT: Duration = Duration::from_secs(90);

pub(super) fn valid_session_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
}

pub(super) fn session_id(frame: &Value) -> Option<&str> {
    frame["session_id"]
        .as_str()
        .or_else(|| frame["sessionId"].as_str())
        .filter(|value| valid_session_id(value))
}

fn turn_context_tokens(value: &Value) -> Option<i64> {
    let usage = value.as_object()?;
    let token = |key: &str| {
        usage
            .get(key)
            .and_then(Value::as_i64)
            .filter(|count| *count >= 0)
            .unwrap_or(0)
    };
    let total = token("input_tokens")
        .saturating_add(token("cache_read_input_tokens"))
        .saturating_add(token("cache_creation_input_tokens"));
    (total > 0).then_some(total)
}

fn model_usage_metadata(
    frame: &Value,
    active_model: Option<&str>,
) -> (Option<String>, Option<i64>) {
    let Some(map) = frame["modelUsage"].as_object() else {
        return (None, None);
    };
    if let Some(model) = active_model
        && let Some(entry) = map.get(model)
    {
        return (
            Some(model.to_owned()),
            entry["contextWindow"].as_i64().filter(|count| *count > 0),
        );
    }
    for (name, entry) in map {
        let window = entry["contextWindow"].as_i64().filter(|count| *count > 0);
        if !name.is_empty() && window.is_some() {
            return (Some(name.clone()), window);
        }
    }
    (map.keys().find(|name| !name.is_empty()).cloned(), None)
}

pub(super) fn usage_snapshot(value: &Value) -> Option<UsageSnapshot> {
    let usage = value.as_object()?;
    let token = |key: &str| {
        usage
            .get(key)
            .and_then(Value::as_i64)
            .filter(|count| *count >= 0)
            .unwrap_or(0)
    };
    let input_tokens = token("input_tokens");
    let cached_input_tokens =
        token("cache_read_input_tokens").saturating_add(token("cache_creation_input_tokens"));
    let output_tokens = token("output_tokens");
    Some(UsageSnapshot {
        context_tokens: None,
        session_tokens: input_tokens
            .saturating_add(cached_input_tokens)
            .saturating_add(output_tokens),
        input_tokens,
        cached_input_tokens,
        output_tokens,
        reasoning_output_tokens: None,
        model_context_window: None,
    })
}

fn parse_rate_limit_event(frame: &Value) -> Vec<ProviderRateLimit> {
    let info = frame
        .get("rate_limit_info")
        .or_else(|| frame.get("rate_limit"))
        .unwrap_or(frame);
    let Some(obj) = info.as_object() else {
        return Vec::new();
    };
    let used_percent = obj
        .get("utilization")
        .and_then(|value| normalize_fraction_percent(value).or_else(|| normalize_percent(value)))
        .or_else(|| obj.get("usedPercent").and_then(normalize_percent))
        .or_else(|| obj.get("used_percent").and_then(normalize_percent));
    let Some(used_percent) = used_percent else {
        return Vec::new();
    };
    let raw_type = obj
        .get("rateLimitType")
        .or_else(|| obj.get("rate_limit_type"))
        .or_else(|| obj.get("window"))
        .and_then(Value::as_str)
        .unwrap_or("5h");
    let (window, label, group) = window_from_type(raw_type);
    let resets_at = obj
        .get("resetsAt")
        .or_else(|| obj.get("resets_at"))
        .or_else(|| obj.get("reset"))
        .and_then(normalize_reset_at);
    let id = match group.as_deref() {
        Some(group_name) => format!("claude:{window}:{group_name}"),
        None => format!("claude:{window}"),
    };
    vec![ProviderRateLimit {
        id,
        label,
        window,
        used_percent,
        remaining_percent: 100_u8.saturating_sub(used_percent),
        resets_at,
        group,
    }]
}

pub(super) fn failure_message(detail: &str) -> &'static str {
    let detail = detail.to_ascii_lowercase();
    if authentication_required(&detail) {
        "Claude Code needs authentication. Run claude auth login, then Retry."
    } else if ["permission", "approval", "requires user input"]
        .iter()
        .any(|signal| detail.contains(signal))
    {
        "Claude Code requested a permission decision that Otto cannot display. Review Claude Code's native permission settings, then retry."
    } else if [
        "429",
        "rate limit",
        "usage limit",
        "quota",
        "insufficient credit",
    ]
    .iter()
    .any(|signal| detail.contains(signal))
    {
        "Claude Code reached a provider usage limit. Check your plan or retry later."
    } else if ["model", "not found", "unsupported", "invalid_request"]
        .iter()
        .any(|signal| detail.contains(signal))
    {
        "The selected Claude Code model is unavailable. Choose another model, then retry."
    } else if [
        "timeout",
        "timed out",
        "network",
        "connection",
        "econn",
        "dns",
    ]
    .iter()
    .any(|signal| detail.contains(signal))
    {
        "Claude Code could not reach its service. Check your internet connection, then retry."
    } else {
        "Claude Code could not finish the answer. Check its native configuration, then retry."
    }
}

#[derive(Default)]
pub(super) struct TurnStream {
    pub(super) session_id: Option<String>,
    pub(super) result_seen: bool,
    model: Option<String>,
    context_tokens: Option<i64>,
    text: String,
    final_text: Option<String>,
    pub(super) failure: Option<String>,
    thinking: Option<(i64, String)>,
    active_tool: Option<(i64, String, String, String)>,
    thinking_count: u32,
}

impl TurnStream {
    pub(super) fn observe(
        &mut self,
        frame: &Value,
        run_id: u64,
        events: &ProviderEvents,
    ) -> Result<(), String> {
        if let Some(session_id) = session_id(frame) {
            self.session_id = Some(session_id.to_owned());
            events.emit(AgentEvent::SessionReady {
                run_id,
                session_id: session_id.to_owned(),
            });
        }
        if let Some(model) = frame["model"]
            .as_str()
            .or_else(|| frame["message"]["model"].as_str())
            .filter(|model| !model.is_empty())
            .map(str::to_owned)
            && self.model.as_ref() != Some(&model)
        {
            self.model = Some(model.clone());
            events.emit(AgentEvent::RuntimeChanged {
                run_id,
                model: Some(model),
                thinking_effort: events.snapshot().thinking_effort,
            });
        }
        self.observe_activity(frame, run_id, events);
        match frame["type"].as_str() {
            Some("assistant") => {
                if let Some(context) = turn_context_tokens(&frame["message"]["usage"]) {
                    self.context_tokens = Some(context);
                }
            }
            Some("stream_event") if frame["event"]["type"] == "message_start" => {
                if let Some(context) = turn_context_tokens(&frame["event"]["message"]["usage"]) {
                    self.context_tokens = Some(context);
                }
            }
            Some("stream_event")
                if frame["event"]["type"] == "content_block_delta"
                    && frame["event"]["delta"]["type"] == "text_delta" =>
            {
                if let Some(delta) = frame["event"]["delta"]["text"].as_str() {
                    if self.text.len().saturating_add(delta.len()) > MAX_ANSWER_BYTES {
                        return Err("Claude Code answer exceeded its supported size.".into());
                    }
                    self.text.push_str(delta);
                    events.emit(AgentEvent::TextDelta {
                        run_id,
                        delta: delta.to_owned(),
                    });
                }
            }
            Some("result") => {
                self.result_seen = true;
                let result = frame["result"].as_str();
                if result.is_some_and(|text| text.len() > MAX_ANSWER_BYTES) {
                    return Err("Claude Code answer exceeded its supported size.".into());
                }
                if frame["is_error"] == true
                    || frame["subtype"]
                        .as_str()
                        .is_some_and(|subtype| subtype.starts_with("error"))
                {
                    self.failure = Some(result.unwrap_or_default().to_owned());
                }
                self.final_text = result.map(str::to_owned);
                let (detected_model, context_window) =
                    model_usage_metadata(frame, self.model.as_deref());
                if self.model.is_none()
                    && let Some(model) = detected_model
                {
                    self.model = Some(model.clone());
                    events.emit(AgentEvent::RuntimeChanged {
                        run_id,
                        model: Some(model),
                        thinking_effort: events.snapshot().thinking_effort,
                    });
                }
                if let Some(mut usage) = usage_snapshot(&frame["usage"]) {
                    let single_turn = frame["num_turns"].as_i64().unwrap_or(1) <= 1;
                    usage.context_tokens = self.context_tokens.or_else(|| {
                        single_turn
                            .then(|| usage.input_tokens.saturating_add(usage.cached_input_tokens))
                            .filter(|count| *count > 0)
                    });
                    usage.model_context_window = context_window;
                    events.emit(AgentEvent::UsageUpdated { run_id, usage });
                }
            }
            Some("rate_limit_event") => {
                let rate_limits = parse_rate_limit_event(frame);
                if !rate_limits.is_empty() {
                    events.emit(AgentEvent::RateLimitsUpdated {
                        run_id,
                        rate_limits,
                    });
                }
            }
            _ => {}
        }
        Ok(())
    }

    fn observe_activity(&mut self, frame: &Value, run_id: u64, events: &ProviderEvents) {
        match frame["type"].as_str() {
            Some("stream_event") => {
                let event = &frame["event"];
                match event["type"].as_str() {
                    Some("content_block_start") => {
                        let block = &event["content_block"];
                        let index = event["index"].as_i64().unwrap_or(-1);
                        match block["type"].as_str() {
                            Some("thinking") => {
                                self.thinking_count = self.thinking_count.saturating_add(1);
                                let activity = format!("thinking:{}", self.thinking_count);
                                events.activity_started(
                                    run_id,
                                    &activity,
                                    ActivityKind::Thinking,
                                    ActivityDetails::default(),
                                );
                                self.thinking = Some((index, activity));
                            }
                            Some("tool_use") => {
                                if let (Some(call), Some(name)) =
                                    (block["id"].as_str(), block["name"].as_str())
                                {
                                    let details =
                                        describe_tool(name, None, block.get("input"), &[]);
                                    events.activity_started(
                                        run_id,
                                        call,
                                        ActivityKind::from_tool(name),
                                        details,
                                    );
                                    self.active_tool = Some((
                                        index,
                                        call.to_owned(),
                                        name.to_owned(),
                                        String::new(),
                                    ));
                                }
                            }
                            _ => {}
                        }
                    }
                    Some("content_block_delta") => {
                        let index = event["index"].as_i64();
                        let delta = &event["delta"];
                        match delta["type"].as_str() {
                            Some("thinking_delta") => {
                                if let (Some((active_idx, activity)), Some(chunk)) =
                                    (&self.thinking, delta["thinking"].as_str())
                                    && index.is_none_or(|value| value == *active_idx)
                                {
                                    events.activity_detail_delta(run_id, activity, chunk);
                                }
                            }
                            Some("input_json_delta") => {
                                if let (Some((active_idx, _, _, buffer)), Some(partial)) =
                                    (&mut self.active_tool, delta["partial_json"].as_str())
                                    && index.is_none_or(|value| value == *active_idx)
                                    && buffer.len().saturating_add(partial.len()) <= 8192
                                {
                                    buffer.push_str(partial);
                                }
                            }
                            _ => {}
                        }
                    }
                    Some("content_block_stop") => {
                        let index = event["index"].as_i64();
                        if self
                            .thinking
                            .as_ref()
                            .is_some_and(|(active_idx, _)| Some(*active_idx) == index)
                            && let Some((_, activity)) = self.thinking.take()
                        {
                            events.activity_finished(run_id, &activity);
                        }
                        if self
                            .active_tool
                            .as_ref()
                            .is_some_and(|(active_idx, _, _, _)| Some(*active_idx) == index)
                            && let Some((_, call, name, raw_json)) = self.active_tool.take()
                            && let Ok(input) = serde_json::from_str::<Value>(&raw_json)
                        {
                            let details = describe_tool(&name, None, Some(&input), &[]);
                            events.activity_updated(run_id, &call, details);
                        }
                    }
                    _ => {}
                }
            }
            Some("assistant") => {
                for block in frame["message"]["content"].as_array().into_iter().flatten() {
                    if block["type"] == "tool_use"
                        && let (Some(call), Some(name)) =
                            (block["id"].as_str(), block["name"].as_str())
                    {
                        let details = describe_tool(name, None, block.get("input"), &[]);
                        events.activity_started(
                            run_id,
                            call,
                            ActivityKind::from_tool(name),
                            details,
                        );
                    } else if block["type"] == "thinking"
                        && self.thinking_count == 0
                        && let Some(text) = block["thinking"].as_str()
                    {
                        self.thinking_count = self.thinking_count.saturating_add(1);
                        let activity = format!("thinking:{}", self.thinking_count);
                        events.activity_started(
                            run_id,
                            &activity,
                            ActivityKind::Thinking,
                            describe_thinking(text),
                        );
                        events.activity_finished(run_id, &activity);
                    }
                }
            }
            Some("user") => {
                for block in frame["message"]["content"].as_array().into_iter().flatten() {
                    if block["type"] == "tool_result"
                        && let Some(call) = block["tool_use_id"].as_str()
                    {
                        events.activity_finished(run_id, call);
                    }
                }
            }
            _ => {}
        }
    }

    pub(super) fn finish(
        self,
        run_id: u64,
        events: &ProviderEvents,
    ) -> Result<Option<String>, String> {
        if let Some(detail) = self.failure {
            return Err(failure_message(&detail).into());
        }
        let answer = self
            .final_text
            .filter(|text| !text.trim().is_empty())
            .unwrap_or(self.text);
        if answer.trim().is_empty() {
            return Err("Claude Code finished without an answer.".into());
        }
        events.emit(AgentEvent::TextFinal {
            run_id,
            text: answer,
        });
        events.emit(AgentEvent::Completed { run_id });
        Ok(self.session_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn claude_usage_snapshot_rejects_negative_and_saturates_totals() {
        let negative = usage_snapshot(&json!({
            "input_tokens": -5,
            "output_tokens": 10
        }))
        .unwrap();
        assert_eq!(negative.input_tokens, 0);
        assert_eq!(negative.output_tokens, 10);

        let huge = usage_snapshot(&json!({
            "input_tokens": i64::MAX,
            "cache_read_input_tokens": 10,
            "output_tokens": 10
        }))
        .unwrap();
        assert_eq!(huge.session_tokens, i64::MAX);
    }

    #[test]
    fn claude_stream_extracts_context_window_and_turn_context_from_model_usage() {
        let mut snapshot = crate::agent::AgentRuntime::new().snapshot();
        snapshot.run_id = 9;
        snapshot.status = crate::agent::RunPhase::Starting;
        let (updates, _) = tokio::sync::watch::channel(snapshot);
        let events = ProviderEvents::new(updates.clone());
        events.emit(AgentEvent::TurnStarted {
            run_id: 9,
            text: "question".into(),
        });
        let mut stream = TurnStream::default();
        stream
            .observe(
                &json!({
                    "type": "assistant",
                    "session_id": "sess-1",
                    "message": {
                        "model": "claude-opus-5",
                        "usage": {
                            "input_tokens": 1200,
                            "cache_read_input_tokens": 8000,
                            "cache_creation_input_tokens": 500,
                            "output_tokens": 40
                        }
                    }
                }),
                9,
                &events,
            )
            .unwrap();
        stream
            .observe(
                &json!({
                    "type": "result",
                    "subtype": "success",
                    "session_id": "sess-1",
                    "result": "Done",
                    "usage": {
                        "input_tokens": 1200,
                        "cache_read_input_tokens": 8000,
                        "cache_creation_input_tokens": 500,
                        "output_tokens": 40
                    },
                    "modelUsage": {
                        "claude-opus-5": {
                            "inputTokens": 1200,
                            "outputTokens": 40,
                            "cacheReadInputTokens": 8000,
                            "cacheCreationInputTokens": 500,
                            "contextWindow": 1000000
                        }
                    }
                }),
                9,
                &events,
            )
            .unwrap();
        let usage = updates.borrow().usage.clone().expect("usage emitted");
        assert!(stream.result_seen);
        assert_eq!(usage.context_tokens, Some(9700));
        assert_eq!(usage.model_context_window, Some(1_000_000));
        assert_eq!(usage.session_tokens, 9740);
    }

    #[test]
    fn claude_thinking_and_tool_blocks_capture_streaming_details() {
        let mut snapshot = crate::agent::AgentRuntime::new().snapshot();
        snapshot.run_id = 4;
        snapshot.status = crate::agent::RunPhase::Starting;
        let (updates, _) = tokio::sync::watch::channel(snapshot);
        let events = ProviderEvents::new(updates.clone());
        let mut stream = TurnStream::default();
        for frame in [
            json!({"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}}),
            json!({"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Checking query\nVerify results"}}}),
            json!({"type":"stream_event","event":{"type":"content_block_stop","index":0}}),
            json!({"type":"stream_event","event":{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"t1","name":"WebSearch"}}}),
            json!({"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"query\":\"rust serde\"}"}}}),
            json!({"type":"stream_event","event":{"type":"content_block_stop","index":1}}),
            json!({"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"WebSearch","input":{"query":"rust serde","token":"top-secret"}}]}}),
        ] {
            stream.observe(&frame, 4, &events).unwrap();
        }
        let list = updates.borrow().activity.clone();
        assert_eq!(list.len(), 2);
        assert!(list[0].done && !list[1].done);
        assert_eq!(list[0].summary.as_deref(), Some("Checking query"));
        assert!(
            list[0]
                .detail
                .as_deref()
                .unwrap()
                .contains("Verify results")
        );
        assert_eq!(list[1].kind, ActivityKind::Search);
        assert_eq!(list[1].summary.as_deref(), Some("rust serde"));
        assert!(
            list[1]
                .detail
                .as_deref()
                .unwrap()
                .contains("token: [redacted]")
        );
        assert!(!list[1].detail.as_deref().unwrap().contains("top-secret"));
        stream
            .observe(&json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1"}]}}), 4, &events)
            .unwrap();
        assert!(updates.borrow().activity[1].done);
    }

    #[test]
    fn claude_rate_limit_events_merge_5h_and_weekly_windows() {
        let mut snapshot = crate::agent::AgentRuntime::new().snapshot();
        snapshot.run_id = 12;
        snapshot.status = crate::agent::RunPhase::Streaming;
        let (updates, _) = tokio::sync::watch::channel(snapshot);
        let events = ProviderEvents::new(updates.clone());
        let mut stream = TurnStream::default();
        stream
            .observe(
                &json!({
                    "type": "rate_limit_event",
                    "rate_limit_info": {
                        "rateLimitType": "five_hour",
                        "utilization": 0.45,
                        "resetsAt": 1_792_100_000
                    }
                }),
                12,
                &events,
            )
            .unwrap();
        stream
            .observe(
                &json!({
                    "type": "rate_limit_event",
                    "rate_limit_info": {
                        "rateLimitType": "seven_day",
                        "utilization": 0.18,
                        "resetsAt": 1_792_500_000
                    }
                }),
                12,
                &events,
            )
            .unwrap();
        let limits = updates.borrow().rate_limits.clone();
        assert_eq!(limits.len(), 2);
        assert_eq!(limits[0].window, "5h");
        assert_eq!(limits[0].used_percent, 45);
        assert_eq!(limits[0].remaining_percent, 55);
        assert_eq!(limits[1].window, "weekly");
        assert_eq!(limits[1].used_percent, 18);
        assert_eq!(limits[1].remaining_percent, 82);
    }
}
