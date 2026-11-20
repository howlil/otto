use super::activity::ActivityDetails;
use serde_json::Value;

pub(crate) const MAX_SUMMARY_CHARS: usize = 120;
pub(crate) const MAX_DETAIL_CHARS: usize = 1200;
const MAX_FIELD_VALUE_CHARS: usize = 400;
const MAX_DETAIL_FIELDS: usize = 12;
const MAX_LOCATIONS: usize = 8;
const DETAIL_INLINE_THRESHOLD: usize = 48;

const SUMMARY_KEYS: &[&str] = &[
    "command",
    "cmd",
    "file_path",
    "filePath",
    "path",
    "target_file",
    "filename",
    "query",
    "q",
    "pattern",
    "url",
    "uri",
    "glob",
    "description",
    "directory",
    "dir",
];

const PATH_KEYS: &[&str] = &[
    "file_path",
    "filePath",
    "path",
    "target_file",
    "filename",
    "directory",
    "dir",
];

const SENSITIVE_KEY_SIGNALS: &[&str] = &[
    "secret",
    "token",
    "password",
    "passwd",
    "api_key",
    "apikey",
    "authorization",
    "cookie",
    "credential",
    "private_key",
];

fn truncate_chars(text: &str, max_chars: usize) -> String {
    let mut iter = text.chars();
    let collected: String = iter.by_ref().take(max_chars).collect();
    if iter.next().is_some() {
        let trimmed: String = collected
            .chars()
            .take(max_chars.saturating_sub(1))
            .collect();
        format!("{}…", trimmed.trim_end())
    } else {
        collected
    }
}

pub(crate) fn clean_summary(raw: &str) -> Option<String> {
    let mut collapsed = String::new();
    let mut last_space = true;
    for ch in raw.chars() {
        if ch.is_control() && !ch.is_whitespace() {
            continue;
        }
        if ch.is_whitespace() {
            if !last_space {
                collapsed.push(' ');
                last_space = true;
            }
        } else {
            collapsed.push(ch);
            last_space = false;
        }
    }
    let trimmed = collapsed.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(truncate_chars(trimmed, MAX_SUMMARY_CHARS))
    }
}

pub(crate) fn clean_detail(raw: &str) -> Option<String> {
    let normalized = raw.replace("\r\n", "\n").replace('\r', "\n");
    let cleaned: String = normalized
        .chars()
        .filter(|ch| !ch.is_control() || matches!(ch, '\n' | '\t'))
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(truncate_chars(trimmed, MAX_DETAIL_CHARS))
    }
}

pub(crate) fn thinking_summary(raw: &str) -> Option<String> {
    for line in raw.replace("\r\n", "\n").replace('\r', "\n").lines() {
        let stripped = line
            .trim()
            .trim_start_matches(['#', '*', '_', '>', '-', ' '])
            .trim_end_matches(['*', '_'])
            .trim();
        if !stripped.is_empty() {
            return clean_summary(stripped);
        }
    }
    clean_summary(raw)
}

pub(crate) fn compact_path(raw: &str) -> String {
    let trimmed = raw.trim();
    let segments: Vec<&str> = trimmed
        .split(['/', '\\'])
        .filter(|segment| !segment.is_empty())
        .collect();
    if segments.len() <= 3 {
        return trimmed.to_owned();
    }
    let tail = &segments[segments.len() - 2..];
    format!("…/{}", tail.join("/"))
}

fn is_sensitive_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    SENSITIVE_KEY_SIGNALS
        .iter()
        .any(|signal| lower.contains(signal))
}

fn is_binary_blob(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.starts_with("data:image/") || trimmed.starts_with("data:application/") {
        return true;
    }
    trimmed.len() > 200
        && !trimmed.chars().any(char::is_whitespace)
        && !trimmed.contains('/')
        && !trimmed.contains('\\')
        && !trimmed.contains(':')
}

fn format_value(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else if is_binary_blob(trimmed) {
                Some("[omitted]".into())
            } else {
                Some(truncate_chars(trimmed, MAX_FIELD_VALUE_CHARS))
            }
        }
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        Value::Array(items) => {
            let parts: Vec<String> = items
                .iter()
                .take(4)
                .filter_map(|item| match item {
                    Value::String(text) if !text.trim().is_empty() && !is_binary_blob(text) => {
                        Some(truncate_chars(text.trim(), 80))
                    }
                    Value::Number(number) => Some(number.to_string()),
                    _ => None,
                })
                .collect();
            if parts.is_empty() {
                None
            } else if items.len() > parts.len() {
                Some(format!(
                    "{} (+{} more)",
                    parts.join(", "),
                    items.len() - parts.len()
                ))
            } else {
                Some(parts.join(", "))
            }
        }
        _ => None,
    }
}

fn pick_input_summary(input: &Value) -> Option<String> {
    if let Some(text) = input.as_str() {
        return (!is_binary_blob(text))
            .then(|| clean_summary(text))
            .flatten();
    }
    let object = input.as_object()?;
    for key in SUMMARY_KEYS {
        if is_sensitive_key(key) {
            continue;
        }
        if let Some(value) = object.get(*key)
            && let Some(formatted) = format_value(value)
            && formatted != "[omitted]"
        {
            let text = if PATH_KEYS.contains(key) {
                compact_path(&formatted)
            } else {
                formatted
            };
            if let Some(summary) = clean_summary(&text) {
                return Some(summary);
            }
        }
    }
    None
}

fn format_input_lines(input: &Value) -> Vec<String> {
    if input.is_string() {
        return format_value(input).into_iter().collect();
    }
    let Some(object) = input.as_object() else {
        return Vec::new();
    };
    let mut lines = Vec::new();
    let mut seen = Vec::new();
    for key in SUMMARY_KEYS {
        if let Some(value) = object.get(*key) {
            seen.push(*key);
            if is_sensitive_key(key) {
                lines.push(format!("{key}: [redacted]"));
            } else if let Some(formatted) = format_value(value) {
                lines.push(format!("{key}: {formatted}"));
            }
        }
    }
    for (key, value) in object {
        if lines.len() >= MAX_DETAIL_FIELDS {
            break;
        }
        if seen.contains(&key.as_str()) {
            continue;
        }
        if is_sensitive_key(key) {
            lines.push(format!("{key}: [redacted]"));
        } else if let Some(formatted) = format_value(value) {
            lines.push(format!("{key}: {formatted}"));
        }
    }
    lines
}

pub(crate) fn describe_thinking(text: &str) -> ActivityDetails {
    let detail = clean_detail(text);
    let summary = detail.as_deref().and_then(thinking_summary);
    ActivityDetails { summary, detail }
}

pub(crate) fn describe_tool(
    tool_name: &str,
    title: Option<&str>,
    input: Option<&Value>,
    locations: &[String],
) -> ActivityDetails {
    let clean_name = clean_summary(tool_name);
    let clean_title = title.and_then(clean_summary);
    let input_summary = input.and_then(pick_input_summary);
    let location_summary = locations.first().map(|first| {
        let short = compact_path(first);
        if locations.len() > 1 {
            format!("{short} (+{} more)", locations.len() - 1)
        } else {
            short
        }
    });
    let summary = clean_title
        .clone()
        .or(input_summary)
        .or_else(|| location_summary.as_deref().and_then(clean_summary))
        .or_else(|| clean_name.clone());

    let mut lines: Vec<String> = Vec::new();
    if let Some(name) = clean_name.as_deref() {
        lines.push(name.to_owned());
    }
    if let Some(raw_title) = title.and_then(clean_detail)
        && lines.first().map(String::as_str) != Some(raw_title.as_str())
    {
        lines.push(raw_title);
    }
    for location in locations.iter().take(MAX_LOCATIONS) {
        if let Some(clean_loc) = clean_detail(location)
            && !lines.iter().any(|existing| existing.contains(&clean_loc))
        {
            lines.push(clean_loc);
        }
    }
    if let Some(value) = input {
        lines.extend(format_input_lines(value));
    }

    let detail = if lines.is_empty() {
        None
    } else {
        let joined = clean_detail(&lines.join("\n"));
        match (&joined, &summary) {
            (Some(text), Some(short))
                if text == short && short.chars().count() <= DETAIL_INLINE_THRESHOLD =>
            {
                None
            }
            _ => joined,
        }
    };

    ActivityDetails { summary, detail }
}

pub(crate) fn describe_changes(changes: &[(Option<&str>, &str)]) -> ActivityDetails {
    let Some((_, first_path)) = changes.first() else {
        return ActivityDetails::default();
    };
    let short = compact_path(first_path);
    let summary = if changes.len() > 1 {
        clean_summary(&format!("{short} (+{} more)", changes.len() - 1))
    } else {
        clean_summary(&short)
    };
    let lines: Vec<String> = changes
        .iter()
        .take(MAX_DETAIL_FIELDS)
        .map(
            |(kind, path)| match kind.filter(|value| !value.trim().is_empty()) {
                Some(kind) => format!("{}: {}", kind.trim(), path.trim()),
                None => path.trim().to_owned(),
            },
        )
        .collect();
    let detail = clean_detail(&lines.join("\n"));
    ActivityDetails { summary, detail }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn describe_tool_extracts_summary_and_redacts_secrets() {
        let input = json!({
            "file_path": "C:\\Users\\demo\\project\\src\\App.tsx",
            "limit": 40,
            "api_key": "sk-secret-value",
            "image": "data:image/png;base64,AAAA"
        });
        let described = describe_tool("Read", None, Some(&input), &[]);
        assert_eq!(described.summary.as_deref(), Some("…/src/App.tsx"));
        let detail = described.detail.unwrap();
        assert!(detail.contains("Read"));
        assert!(detail.contains("C:\\Users\\demo\\project\\src\\App.tsx"));
        assert!(detail.contains("api_key: [redacted]"));
        assert!(detail.contains("image: [omitted]"));
        assert!(!detail.contains("sk-secret-value"));
    }
}
