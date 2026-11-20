use crate::agent::activity::describe_tool;
use crate::agent::events::{AgentEvent, ProviderEvents};
use crate::agent::providers::encode_png_capture;
use crate::agent::{ActivityDetails, ActivityKind, CapturedImage, UsageSnapshot};
use serde_json::{Value, json};

pub(super) fn tool_kind(kind: &str) -> ActivityKind {
    match kind {
        "read" => ActivityKind::Read,
        "edit" | "delete" | "move" => ActivityKind::Edit,
        "search" | "fetch" => ActivityKind::Search,
        "execute" => ActivityKind::Command,
        "think" => ActivityKind::Thinking,
        _ => ActivityKind::Other,
    }
}

pub(super) fn tool_details(update: &Value) -> ActivityDetails {
    let title = update["title"].as_str();
    let locations: Vec<String> = update["locations"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|location| {
            let path = location["path"].as_str()?.trim();
            if path.is_empty() {
                return None;
            }
            match location["line"].as_i64().filter(|line| *line > 0) {
                Some(line) => Some(format!("{path}:{line}")),
                None => Some(path.to_owned()),
            }
        })
        .collect();
    describe_tool("", title, update.get("rawInput"), &locations)
}

pub(super) fn usage_snapshot(
    usage: &Value,
    context_tokens: Option<i64>,
    model_context_window: Option<i64>,
) -> Option<UsageSnapshot> {
    let tokens = |name: &str| usage[name].as_i64().filter(|count| *count >= 0);
    Some(UsageSnapshot {
        context_tokens,
        session_tokens: tokens("totalTokens")?,
        input_tokens: tokens("inputTokens")?,
        cached_input_tokens: tokens("cachedReadTokens").unwrap_or(0),
        output_tokens: tokens("outputTokens")?,
        reasoning_output_tokens: tokens("thoughtTokens"),
        model_context_window,
    })
}

pub(super) async fn prompt_params(
    session_id: &str,
    text: &str,
    capture: Option<&CapturedImage>,
) -> Result<Value, String> {
    let mut blocks = vec![json!({ "type": "text", "text": text })];
    if let Some(image) = capture {
        let path = image.path().to_owned();
        let encoded = tokio::task::spawn_blocking(move || encode_png_capture(&path))
            .await
            .map_err(|_| "Image preparation was interrupted.".to_string())??;
        blocks.push(json!({
            "type": "image",
            "data": encoded,
            "mimeType": "image/png"
        }));
    }
    Ok(json!({
        "sessionId": session_id,
        "prompt": blocks
    }))
}

pub(super) fn begin(events: &ProviderEvents, id: u64, display_text: &str) {
    events.emit(AgentEvent::TurnStarted {
        run_id: id,
        text: display_text.to_owned(),
    });
}
