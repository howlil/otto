use crate::agent::ProviderRateLimit;
use crate::agent::providers::rate_limits::{
    normalize_percent, normalize_reset_at, window_from_duration_mins,
};
use serde_json::Value;

fn non_empty_text(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty() && text.len() <= 80)
        .map(str::to_owned)
}

fn parse_group(
    key: &str,
    group_value: &Value,
    multiple_groups: bool,
    out: &mut Vec<ProviderRateLimit>,
) {
    let Some(group) = group_value.as_object() else {
        return;
    };
    let model = group.get("normalModelSlug").and_then(non_empty_text);
    let limit_name = group.get("limitName").and_then(non_empty_text);
    let limit_id = group
        .get("limitId")
        .and_then(non_empty_text)
        .unwrap_or_else(|| key.to_owned());
    let display_group = model.or(limit_name).or_else(|| {
        (multiple_groups || !limit_id.eq_ignore_ascii_case("codex")).then(|| limit_id.clone())
    });

    for (slot, default_window, default_label) in [
        ("primary", "5h", "5h limit"),
        ("secondary", "weekly", "Weekly limit"),
    ] {
        let Some(window_obj) = group.get(slot).and_then(Value::as_object) else {
            continue;
        };
        let Some(used_percent) = window_obj.get("usedPercent").and_then(normalize_percent) else {
            continue;
        };
        let (window, label) = window_obj
            .get("windowDurationMins")
            .and_then(Value::as_i64)
            .and_then(window_from_duration_mins)
            .unwrap_or_else(|| (default_window.to_owned(), default_label.to_owned()));
        let resets_at = window_obj.get("resetsAt").and_then(normalize_reset_at);
        out.push(ProviderRateLimit {
            id: format!("codex:{limit_id}:{slot}"),
            label,
            window,
            used_percent,
            remaining_percent: 100_u8.saturating_sub(used_percent),
            resets_at,
            group: display_group.clone(),
        });
    }
}

pub(super) fn parse_rate_limits(value: &Value) -> Vec<ProviderRateLimit> {
    let mut results = Vec::new();
    if let Some(map) = value.get("rateLimitsByLimitId").and_then(Value::as_object)
        && !map.is_empty()
    {
        let mut entries: Vec<(&String, &Value)> = map.iter().take(16).collect();
        entries.sort_by_key(|(key, _)| (key.as_str() != "codex", key.as_str()));
        let multiple = entries.len() > 1;
        for (key, group) in entries {
            parse_group(key, group, multiple, &mut results);
        }
        return results;
    }
    if let Some(group) = value.get("rateLimits") {
        parse_group("codex", group, false, &mut results);
    }
    results
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_codex_primary_5h_and_secondary_weekly_rate_limits() {
        let limits = parse_rate_limits(&json!({
            "rateLimits": {
                "limitId": "codex",
                "limitName": null,
                "primary": {
                    "usedPercent": 25,
                    "windowDurationMins": 300,
                    "resetsAt": 1_792_100_000
                },
                "secondary": {
                    "usedPercent": 9,
                    "windowDurationMins": 10080,
                    "resetsAt": 1_792_500_000
                }
            },
            "rateLimitsByLimitId": null
        }));
        assert_eq!(limits.len(), 2);
        assert_eq!(limits[0].window, "5h");
        assert_eq!(limits[0].label, "5h limit");
        assert_eq!(limits[0].used_percent, 25);
        assert_eq!(limits[0].remaining_percent, 75);
        assert_eq!(limits[0].group, None);
        assert_eq!(limits[0].resets_at.as_deref(), Some("2026-10-15T21:33:20Z"));
        assert_eq!(limits[1].window, "weekly");
        assert_eq!(limits[1].label, "Weekly limit");
        assert_eq!(limits[1].used_percent, 9);
        assert_eq!(limits[1].remaining_percent, 91);
    }

    #[test]
    fn parses_model_specific_rate_limits_and_ignores_out_of_range_values() {
        let limits = parse_rate_limits(&json!({
            "rateLimitsByLimitId": {
                "custom": {
                    "limitId": "custom",
                    "normalModelSlug": "gpt-6",
                    "primary": { "usedPercent": 80 },
                    "secondary": { "usedPercent": 150 }
                }
            }
        }));
        assert_eq!(limits.len(), 1);
        assert_eq!(limits[0].group.as_deref(), Some("gpt-6"));
        assert_eq!(limits[0].window, "5h");
        assert_eq!(limits[0].used_percent, 80);
        assert_eq!(limits[0].remaining_percent, 20);
    }
}
