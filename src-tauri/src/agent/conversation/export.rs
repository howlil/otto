use super::history::ConversationRecord;
use crate::agent::ProviderId;

fn provider_display_name(provider: ProviderId) -> &'static str {
    match provider {
        ProviderId::Codex => "Codex",
        ProviderId::Pi => "Pi",
        ProviderId::Agy => "Agy",
        ProviderId::Opencode => "OpenCode",
        ProviderId::Claude => "Claude Code",
        ProviderId::Gemini => "Gemini CLI",
        ProviderId::Copilot => "GitHub Copilot",
        ProviderId::Qwen => "Qwen Code",
        ProviderId::Cursor => "Cursor Agent",
        ProviderId::Goose => "Goose",
        ProviderId::Vibe => "Mistral Vibe",
        ProviderId::Amp => "Amp",
        ProviderId::Kilo => "Kilo Code",
        ProviderId::Junie => "Junie",
        ProviderId::Cline => "Cline",
        ProviderId::Augment => "Augment Code",
        ProviderId::Droid => "Factory Droid",
        ProviderId::Grok => "Grok Build",
        ProviderId::Devin => "Devin",
    }
}

pub(super) fn matches_query(record: &ConversationRecord, query: &str) -> bool {
    let tokens: Vec<String> = query
        .split_whitespace()
        .map(|token| token.to_ascii_lowercase())
        .filter(|token| !token.is_empty())
        .collect();
    if tokens.is_empty() {
        return true;
    }
    let title = record.title.to_ascii_lowercase();
    let provider_id = record.provider.as_str();
    let provider_name = provider_display_name(record.provider).to_ascii_lowercase();
    let message_texts: Vec<String> = record
        .messages
        .iter()
        .map(|message| message.text.to_ascii_lowercase())
        .collect();
    tokens.iter().all(|token| {
        title.contains(token)
            || provider_id.contains(token)
            || provider_name.contains(token)
            || (record.interrupted && "interrupted".contains(token))
            || message_texts.iter().any(|text| text.contains(token))
    })
}

pub(super) fn matching_preview(
    record: &ConversationRecord,
    query: Option<&str>,
    max_chars: usize,
) -> String {
    let tokens: Vec<String> = query
        .unwrap_or_default()
        .split_whitespace()
        .map(|token| token.to_ascii_lowercase())
        .filter(|token| !token.is_empty())
        .collect();
    if !tokens.is_empty()
        && let Some(matched) = record.messages.iter().find(|message| {
            let lower = message.text.to_ascii_lowercase();
            tokens.iter().any(|token| lower.contains(token))
        })
    {
        return compact_snippet(&matched.text, &tokens[0], max_chars);
    }
    record
        .messages
        .first()
        .map(|message| message.text.chars().take(max_chars).collect())
        .unwrap_or_default()
}

fn compact_snippet(text: &str, token: &str, max_chars: usize) -> String {
    let single_line: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let chars: Vec<char> = single_line.chars().collect();
    if chars.len() <= max_chars {
        return single_line;
    }
    let lower_chars: Vec<char> = single_line.to_ascii_lowercase().chars().collect();
    let token_chars: Vec<char> = token.chars().collect();
    let hit = lower_chars
        .windows(token_chars.len().max(1))
        .position(|window| window == token_chars.as_slice())
        .unwrap_or(0);
    let start = hit.saturating_sub(max_chars / 3);
    let end = (start + max_chars).min(chars.len());
    let slice: String = chars[start..end].iter().collect();
    if start > 0 {
        format!("…{}", slice.trim_start())
    } else {
        slice
    }
}

pub(super) fn format_conversation_markdown(record: &ConversationRecord) -> String {
    let mut lines = Vec::new();
    lines.push(format!("# {}", record.title.trim()));
    lines.push(String::new());
    lines.push(format!(
        "- Engine: {}",
        provider_display_name(record.provider)
    ));
    if let Some(model) = record
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("- Model: {model}"));
    }
    if let Some(effort) = record
        .thinking_effort
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("- Thinking effort: {effort}"));
    }
    if record.interrupted {
        lines.push("- Status: Interrupted".into());
    }
    lines.push(String::new());
    lines.push("---".into());
    for message in &record.messages {
        let heading = if message.role == "user" {
            "## You"
        } else {
            "## Otto"
        };
        lines.push(String::new());
        lines.push(heading.into());
        lines.push(String::new());
        lines.push(message.text.clone());
    }
    lines.push(String::new());
    lines.join("\n")
}
