use crate::agent::activity::{
    clean_detail, clean_summary, describe_changes, describe_thinking, describe_tool,
};
use crate::agent::events::{AgentEvent, ProviderEvents};
use crate::agent::providers::authentication_required;
use crate::agent::{ActivityDetails, ActivityKind, UsageSnapshot};
use serde_json::Value;

pub(super) fn is_for_turn(value: &Value, thread: &str, turn: &str) -> bool {
    let turn_matches = value["params"]["turnId"].as_str() == Some(turn)
        || value["params"]["turn"]["id"].as_str() == Some(turn);
    let thread_matches = match value["params"]["threadId"].as_str() {
        Some(id) => id == thread,
        None => value["method"].as_str() == Some("turn/completed") && turn_matches,
    };
    turn_matches && thread_matches
}

pub(super) fn handle_delta(value: &Value, run_id: u64, updates: &ProviderEvents) {
    if let Some(delta) = value["params"]["delta"].as_str() {
        updates.emit(AgentEvent::TextDelta {
            run_id,
            delta: delta.to_owned(),
        });
    }
}

fn item_activity_kind(item: &Value) -> Option<ActivityKind> {
    match item["type"].as_str()? {
        "reasoning" => Some(ActivityKind::Thinking),
        "commandExecution" => Some(ActivityKind::Command),
        "fileChange" => Some(ActivityKind::Edit),
        "webSearch" => Some(ActivityKind::Search),
        "mcpToolCall" | "dynamicToolCall" => Some(ActivityKind::Other),
        _ => None,
    }
}

fn reasoning_text(item: &Value) -> String {
    let mut parts: Vec<&str> = Vec::new();
    if let Some(summary) = item["summary"].as_str() {
        parts.push(summary);
    } else if let Some(items) = item["summary"].as_array() {
        for entry in items {
            if let Some(text) = entry.as_str().or_else(|| entry["text"].as_str()) {
                parts.push(text);
            }
        }
    }
    if parts.is_empty()
        && let Some(content) = item["content"].as_array()
    {
        for entry in content {
            if let Some(text) = entry.as_str().or_else(|| entry["text"].as_str()) {
                parts.push(text);
            }
        }
    }
    parts.join("\n")
}

fn command_text(item: &Value) -> Option<String> {
    if let Some(command) = item["command"].as_str() {
        return Some(command.to_owned());
    }
    item["command"].as_array().map(|parts| {
        parts
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(" ")
    })
}

fn item_activity_details(item: &Value) -> ActivityDetails {
    match item["type"].as_str().unwrap_or_default() {
        "reasoning" => describe_thinking(&reasoning_text(item)),
        "commandExecution" => {
            let command = command_text(item);
            let cwd = item["cwd"]
                .as_str()
                .filter(|value| !value.trim().is_empty());
            let summary = command.as_deref().and_then(clean_summary);
            let mut lines = Vec::new();
            if let Some(cmd) = command.as_deref().and_then(clean_detail) {
                lines.push(cmd);
            }
            if let Some(dir) = cwd.and_then(clean_detail) {
                lines.push(format!("cwd: {dir}"));
            }
            let detail =
                if lines.len() > 1 || summary.as_ref().is_some_and(|s| s.chars().count() > 48) {
                    clean_detail(&lines.join("\n"))
                } else {
                    None
                };
            ActivityDetails { summary, detail }
        }
        "fileChange" => {
            let entries: Vec<(Option<&str>, &str)> = item["changes"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|entry| {
                    let path = entry["path"].as_str()?;
                    Some((entry["kind"].as_str(), path))
                })
                .collect();
            describe_changes(&entries)
        }
        "webSearch" => {
            let query = item["query"]
                .as_str()
                .or_else(|| item["action"]["query"].as_str());
            describe_tool("", query, None, &[])
        }
        "mcpToolCall" => {
            let tool = item["tool"].as_str().unwrap_or_default();
            let server = item["server"].as_str().filter(|value| !value.is_empty());
            let name = match server {
                Some(server) if !tool.is_empty() => format!("{server}/{tool}"),
                Some(server) => server.to_owned(),
                None => tool.to_owned(),
            };
            describe_tool(&name, None, item.get("arguments"), &[])
        }
        "dynamicToolCall" => {
            let tool = item["tool"].as_str().unwrap_or_default();
            describe_tool(tool, None, item.get("arguments"), &[])
        }
        _ => ActivityDetails::default(),
    }
}

pub(super) fn handle_item_started(value: &Value, run_id: u64, updates: &ProviderEvents) {
    let item = &value["params"]["item"];
    if let (Some(id), Some(kind)) = (item["id"].as_str(), item_activity_kind(item)) {
        updates.activity_started(run_id, id, kind, item_activity_details(item));
    }
}

pub(super) fn handle_item_completed(value: &Value, run_id: u64, updates: &ProviderEvents) -> bool {
    let item = &value["params"]["item"];
    if let (Some(id), Some(kind)) = (item["id"].as_str(), item_activity_kind(item)) {
        updates.activity_started(run_id, id, kind, item_activity_details(item));
        updates.activity_finished(run_id, id);
    }
    if item["type"].as_str() == Some("agentMessage")
        && let Some(text) = item["text"].as_str()
    {
        updates.emit(AgentEvent::TextFinal {
            run_id,
            text: text.to_owned(),
        });
    }
    false
}

fn handle_reasoning_delta(value: &Value, run_id: u64, updates: &ProviderEvents) {
    if let (Some(id), Some(delta)) = (
        value["params"]["itemId"].as_str(),
        value["params"]["delta"].as_str(),
    ) {
        updates.activity_started(
            run_id,
            id,
            ActivityKind::Thinking,
            ActivityDetails::default(),
        );
        updates.activity_detail_delta(run_id, id, delta);
    }
}

pub(super) fn usage_snapshot(value: &Value) -> Option<UsageSnapshot> {
    let token_usage = &value["params"]["tokenUsage"];
    let last = &token_usage["last"];
    let total = &token_usage["total"];
    let non_negative = |field: &Value| field.as_i64().filter(|count| *count >= 0);
    token_usage.is_object().then(|| UsageSnapshot {
        context_tokens: non_negative(&last["totalTokens"]),
        session_tokens: non_negative(&total["totalTokens"]).unwrap_or(0),
        input_tokens: non_negative(&last["inputTokens"]).unwrap_or(0),
        cached_input_tokens: non_negative(&last["cachedInputTokens"]).unwrap_or(0),
        output_tokens: non_negative(&last["outputTokens"]).unwrap_or(0),
        reasoning_output_tokens: non_negative(&last["reasoningOutputTokens"]),
        model_context_window: token_usage["modelContextWindow"]
            .as_i64()
            .filter(|count| *count > 0),
    })
}

pub(super) fn turn_failure_message(value: &Value) -> &'static str {
    let detail = value["params"]["turn"]["error"]["message"]
        .as_str()
        .or_else(|| value["params"]["error"]["message"].as_str())
        .unwrap_or_default();
    let lower = detail.to_ascii_lowercase();
    if authentication_required(&lower) {
        "Codex authentication expired. Sign in to Codex, then Retry."
    } else if ["429", "rate limit", "usage limit", "quota", "insufficient"]
        .iter()
        .any(|signal| lower.contains(signal))
    {
        "Codex reached its usage or rate limit. Wait a moment or switch model, then Retry."
    } else if ["model", "unsupported", "not found"]
        .iter()
        .any(|signal| lower.contains(signal))
    {
        "Selected Codex model is unavailable. Choose another model in Settings, then Retry."
    } else if ["network", "connection", "timed out", "timeout", "dns"]
        .iter()
        .any(|signal| lower.contains(signal))
    {
        "Codex could not reach the model service. Check your internet connection, then Retry."
    } else {
        "Codex turn did not complete."
    }
}

pub(super) fn handle_turn_completed(value: &Value, run_id: u64, updates: &ProviderEvents) {
    match value["params"]["turn"]["status"].as_str() {
        Some("completed") => updates.emit(AgentEvent::Completed { run_id }),
        Some("interrupted") => updates.stopped(run_id),
        _ => updates.fail(run_id, turn_failure_message(value)),
    }
}

pub(super) fn handle_event(
    value: &Value,
    thread: &str,
    turn: &str,
    run_id: u64,
    updates: &ProviderEvents,
) -> bool {
    if value["method"].as_str() == Some("account/rateLimits/updated") {
        let rate_limits = super::rate_limits::parse_rate_limits(&value["params"]);
        if !rate_limits.is_empty() {
            updates.emit(AgentEvent::RateLimitsUpdated {
                run_id,
                rate_limits,
            });
        }
        return false;
    }
    if !is_for_turn(value, thread, turn) {
        return false;
    }
    match value["method"].as_str() {
        Some("item/agentMessage/delta") => handle_delta(value, run_id, updates),
        Some("item/started") => handle_item_started(value, run_id, updates),
        Some("item/completed") => return handle_item_completed(value, run_id, updates),
        Some("item/reasoning/summaryTextDelta" | "item/reasoning/textDelta") => {
            handle_reasoning_delta(value, run_id, updates);
        }
        Some("thread/tokenUsage/updated") => {
            if let Some(usage) = usage_snapshot(value) {
                updates.emit(AgentEvent::UsageUpdated { run_id, usage });
            }
        }
        Some("model/rerouted") => {
            if let Some(model) = value["params"]["toModel"].as_str() {
                updates.emit(AgentEvent::RuntimeChanged {
                    run_id,
                    model: Some(model.to_owned()),
                    thinking_effort: updates.snapshot().thinking_effort,
                });
            }
        }
        Some("turn/completed") => {
            handle_turn_completed(value, run_id, updates);
            return true;
        }
        _ => {}
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_items_and_reasoning_deltas_capture_step_details() {
        let mut snapshot = crate::agent::AgentRuntime::new().snapshot();
        snapshot.run_id = 3;
        snapshot.status = crate::agent::RunPhase::Starting;
        let (updates, _) = tokio::sync::watch::channel(snapshot);
        let events = ProviderEvents::new(updates.clone());
        for frame in [
            serde_json::json!({"method":"item/started","params":{"threadId":"t","turnId":"u","item":{"id":"r1","type":"reasoning"}}}),
            serde_json::json!({"method":"item/reasoning/summaryTextDelta","params":{"threadId":"t","turnId":"u","itemId":"r1","delta":"Checking layout\n"}}),
            serde_json::json!({"method":"item/reasoning/summaryTextDelta","params":{"threadId":"t","turnId":"u","itemId":"r1","delta":"Inspecting ActivityTrail"}}),
            serde_json::json!({"method":"item/started","params":{"threadId":"t","turnId":"u","item":{"id":"s1","type":"webSearch","query":"Tauri channels"}}}),
            serde_json::json!({"method":"item/started","params":{"threadId":"t","turnId":"u","item":{"id":"m1","type":"agentMessage"}}}),
            serde_json::json!({"method":"item/started","params":{"threadId":"t","turnId":"u","item":{"id":"c1","type":"commandExecution","command":"cargo test --lib","cwd":"C:\\repo"}}}),
        ] {
            handle_event(&frame, "t", "u", 3, &events);
        }
        let list = updates.borrow().activity.clone();
        assert_eq!(list.len(), 3);
        assert_eq!(list[0].kind, ActivityKind::Thinking);
        assert_eq!(list[0].summary.as_deref(), Some("Checking layout"));
        assert!(
            list[0]
                .detail
                .as_deref()
                .unwrap()
                .contains("Inspecting ActivityTrail")
        );
        assert_eq!(list[1].kind, ActivityKind::Search);
        assert_eq!(list[1].summary.as_deref(), Some("Tauri channels"));
        assert_eq!(list[2].kind, ActivityKind::Command);
        assert_eq!(list[2].summary.as_deref(), Some("cargo test --lib"));
        assert!(list[2].detail.as_deref().unwrap().contains("cwd: C:\\repo"));
        let done = serde_json::json!({"method":"item/completed","params":{"threadId":"t","turnId":"u","item":{"id":"s1","type":"webSearch","query":"Tauri channels"}}});
        handle_event(&done, "t", "u", 3, &events);
        assert!(updates.borrow().activity[1].done);
    }
}
