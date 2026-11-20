use crate::agent::ProviderRateLimit;
use crate::agent::providers::command_for_binary;
use crate::agent::providers::job::Job;
use crate::agent::providers::rate_limits::{
    normalize_fraction_percent, normalize_reset_at, window_from_type,
};
use serde_json::Value;
use std::{path::Path, process::Stdio, time::Duration};

pub(super) fn version_supports_usage(output: &str) -> bool {
    for token in output.split(|ch: char| !(ch.is_ascii_digit() || ch == '.')) {
        let mut parts = token.split('.');
        let (Some(major), Some(minor), Some(patch)) = (
            parts.next().and_then(|value| value.parse::<u32>().ok()),
            parts.next().and_then(|value| value.parse::<u32>().ok()),
            parts.next().and_then(|value| value.parse::<u32>().ok()),
        ) else {
            continue;
        };
        if parts.next().is_some() {
            continue;
        }
        return major > 1 || (major == 1 && (minor > 2 || (minor == 2 && patch >= 15)));
    }
    false
}

fn non_empty_text(value: &Value) -> Option<&str> {
    value
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty() && text.len() <= 80)
}

pub(super) fn parse_agy_usage(value: &Value) -> Vec<ProviderRateLimit> {
    let Some(root) = value.as_object() else {
        return Vec::new();
    };
    if root.get("status").and_then(Value::as_str) != Some("SUCCESS") {
        return Vec::new();
    }
    if root.get("num_turns").and_then(Value::as_i64) != Some(0) {
        return Vec::new();
    }
    if root
        .get("conversation_id")
        .and_then(Value::as_str)
        .is_some_and(|id| !id.trim().is_empty())
    {
        return Vec::new();
    }
    let Some(command) = root.get("command").and_then(Value::as_object) else {
        return Vec::new();
    };
    if command.get("name").and_then(Value::as_str) != Some("usage") {
        return Vec::new();
    }
    let Some(groups) = command
        .get("data")
        .and_then(|data| data.get("groups"))
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };
    let mut results = Vec::new();
    for group_value in groups.iter().take(16) {
        let Some(group) = group_value.as_object() else {
            continue;
        };
        let Some(group_name) = group.get("name").and_then(non_empty_text) else {
            continue;
        };
        let Some(buckets) = group.get("buckets").and_then(Value::as_array) else {
            continue;
        };
        for bucket_value in buckets.iter().take(8) {
            let Some(bucket) = bucket_value.as_object() else {
                continue;
            };
            let Some(remaining_percent) = bucket
                .get("remaining_fraction")
                .and_then(normalize_fraction_percent)
            else {
                continue;
            };
            let raw_window = bucket
                .get("window")
                .and_then(non_empty_text)
                .or_else(|| bucket.get("id").and_then(non_empty_text))
                .or_else(|| bucket.get("name").and_then(non_empty_text))
                .unwrap_or("limit");
            let (window, default_label, _) = window_from_type(raw_window);
            let label = bucket
                .get("name")
                .and_then(non_empty_text)
                .map(str::to_owned)
                .unwrap_or(default_label);
            let key_part = bucket
                .get("id")
                .and_then(non_empty_text)
                .unwrap_or(raw_window);
            let resets_at = bucket.get("reset_time").and_then(normalize_reset_at);
            results.push(ProviderRateLimit {
                id: format!("agy:{group_name}:{key_part}"),
                label,
                window,
                used_percent: 100_u8.saturating_sub(remaining_percent),
                remaining_percent,
                resets_at,
                group: Some(group_name.to_owned()),
            });
            if results.len() >= 32 {
                return results;
            }
        }
    }
    results
}

pub(super) async fn probe_agy_rate_limits(cwd: &Path, binary: &Path) -> Vec<ProviderRateLimit> {
    let mut version_cmd = command_for_binary(binary);
    version_cmd
        .arg("--version")
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let Ok(version_output) = Job::probe(version_cmd, Duration::from_secs(4)).await else {
        return Vec::new();
    };
    if !version_output.status.success() {
        return Vec::new();
    }
    let version_text = String::from_utf8_lossy(&version_output.stdout);
    if !version_supports_usage(&version_text) {
        return Vec::new();
    }
    let mut usage_cmd = command_for_binary(binary);
    usage_cmd
        .args(["--output-format", "json", "-p", "/usage"])
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let Ok(usage_output) = Job::probe(usage_cmd, Duration::from_secs(8)).await else {
        return Vec::new();
    };
    if !usage_output.status.success() {
        return Vec::new();
    }
    serde_json::from_slice::<Value>(&usage_output.stdout)
        .map(|value| parse_agy_usage(&value))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn checks_agy_minimum_version_for_read_only_usage() {
        assert!(version_supports_usage("agy 1.2.15"));
        assert!(version_supports_usage("1.3.0"));
        assert!(version_supports_usage("2.0.0"));
        assert!(!version_supports_usage("agy 1.2.14"));
        assert!(!version_supports_usage("unknown"));
    }

    #[test]
    fn parses_agy_5h_and_weekly_usage_and_rejects_model_turns() {
        let payload = json!({
            "conversation_id": "",
            "status": "SUCCESS",
            "num_turns": 0,
            "command": {
                "name": "usage",
                "data": {
                    "groups": [
                        {
                            "name": "Gemini Models",
                            "buckets": [
                                { "id": "5h", "name": "5h limit", "window": "5h", "remaining_fraction": 0.03, "reset_time": "2026-10-15T08:00:00Z" },
                                { "id": "weekly", "name": "Weekly limit", "remaining_fraction": 0.68, "reset_time": "2026-10-20T08:00:00Z" }
                            ]
                        }
                    ]
                }
            }
        });
        let limits = parse_agy_usage(&payload);
        assert_eq!(limits.len(), 2);
        assert_eq!(limits[0].window, "5h");
        assert_eq!(limits[0].used_percent, 97);
        assert_eq!(limits[0].remaining_percent, 3);
        assert_eq!(limits[0].group.as_deref(), Some("Gemini Models"));
        assert_eq!(limits[1].window, "weekly");
        assert_eq!(limits[1].used_percent, 32);
        assert_eq!(limits[1].remaining_percent, 68);

        let mut model_turn = payload.clone();
        model_turn["num_turns"] = json!(1);
        assert!(parse_agy_usage(&model_turn).is_empty());

        let mut with_conv = payload;
        with_conv["conversation_id"] = json!("conv-123");
        assert!(parse_agy_usage(&with_conv).is_empty());
    }
}
