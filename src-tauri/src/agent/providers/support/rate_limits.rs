use serde_json::Value;

pub(in crate::agent::providers) fn normalize_percent(value: &Value) -> Option<u8> {
    let raw = value.as_f64()?;
    if !raw.is_finite() || !(0.0..=100.0).contains(&raw) {
        return None;
    }
    Some(raw.round() as u8)
}

pub(in crate::agent::providers) fn normalize_fraction_percent(value: &Value) -> Option<u8> {
    let raw = value.as_f64()?;
    if !raw.is_finite() || !(0.0..=1.0).contains(&raw) {
        return None;
    }
    Some((raw * 100.0).round() as u8)
}

pub(in crate::agent::providers) fn unix_secs_to_iso8601(secs: i64) -> Option<String> {
    if !(0..=253_402_300_799).contains(&secs) {
        return None;
    }
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let hour = rem / 3600;
    let min = (rem % 3600) / 60;
    let sec = rem % 60;
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = y + i64::from(month <= 2);
    Some(format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{min:02}:{sec:02}Z"
    ))
}

pub(in crate::agent::providers) fn normalize_reset_at(value: &Value) -> Option<String> {
    if let Some(secs) = value.as_i64().filter(|stamp| *stamp > 0) {
        let normalized = if secs >= 1_000_000_000_000 {
            secs / 1000
        } else {
            secs
        };
        return unix_secs_to_iso8601(normalized);
    }
    if let Some(raw) = value
        .as_f64()
        .filter(|stamp| stamp.is_finite() && *stamp > 0.0)
    {
        let secs = raw as i64;
        let normalized = if secs >= 1_000_000_000_000 {
            secs / 1000
        } else {
            secs
        };
        return unix_secs_to_iso8601(normalized);
    }
    let text = value.as_str()?.trim();
    if text.is_empty() || text.len() > 64 {
        return None;
    }
    if text.bytes().all(|byte| byte.is_ascii_digit()) {
        return text
            .parse::<i64>()
            .ok()
            .filter(|stamp| *stamp > 0)
            .and_then(|secs| {
                let normalized = if secs >= 1_000_000_000_000 {
                    secs / 1000
                } else {
                    secs
                };
                unix_secs_to_iso8601(normalized)
            });
    }
    Some(text.to_owned())
}

pub(in crate::agent::providers) fn window_from_duration_mins(
    mins: i64,
) -> Option<(String, String)> {
    if mins <= 0 {
        return None;
    }
    if mins == 300 {
        return Some(("5h".into(), "5h limit".into()));
    }
    if mins == 10_080 {
        return Some(("weekly".into(), "Weekly limit".into()));
    }
    if mins % 1440 == 0 {
        let days = mins / 1440;
        return Some((format!("{days}d"), format!("{days}d limit")));
    }
    if mins % 60 == 0 {
        let hours = mins / 60;
        return Some((format!("{hours}h"), format!("{hours}h limit")));
    }
    Some((format!("{mins}m"), format!("{mins}m limit")))
}

pub(in crate::agent::providers) fn window_from_type(raw: &str) -> (String, String, Option<String>) {
    let normalized = raw.trim().to_ascii_lowercase().replace('-', "_");
    match normalized.as_str() {
        "5h" | "5hr" | "five_hour" | "rolling_5h" | "5_hour" | "5h limit" | "session" => {
            ("5h".into(), "5h limit".into(), None)
        }
        "weekly" | "week" | "7d" | "seven_day" | "7_day" | "weekly limit" => {
            ("weekly".into(), "Weekly limit".into(), None)
        }
        value if value.starts_with("seven_day_") => {
            let suffix = value.trim_start_matches("seven_day_");
            let group = title_case(suffix);
            ("weekly".into(), "Weekly limit".into(), group)
        }
        value if value.starts_with("five_hour_") => {
            let suffix = value.trim_start_matches("five_hour_");
            let group = title_case(suffix);
            ("5h".into(), "5h limit".into(), group)
        }
        _ => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                ("limit".into(), "Usage limit".into(), None)
            } else {
                (trimmed.to_ascii_lowercase(), trimmed.to_owned(), None)
            }
        }
    }
}

fn title_case(value: &str) -> Option<String> {
    let words: Vec<String> = value
        .split(['_', '-', ' '])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect();
    (!words.is_empty()).then(|| words.join(" "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalizes_percentages_and_reset_timestamps() {
        assert_eq!(normalize_percent(&json!(42.4)), Some(42));
        assert_eq!(normalize_percent(&json!(100)), Some(100));
        assert_eq!(normalize_percent(&json!(150)), None);
        assert_eq!(normalize_percent(&json!(-1)), None);
        assert_eq!(normalize_fraction_percent(&json!(0.03)), Some(3));
        assert_eq!(normalize_fraction_percent(&json!(1.0)), Some(100));
        assert_eq!(normalize_fraction_percent(&json!(1.2)), None);
        assert_eq!(
            unix_secs_to_iso8601(0).as_deref(),
            Some("1970-01-01T00:00:00Z")
        );
        assert_eq!(
            normalize_reset_at(&json!(1_792_100_000)).as_deref(),
            Some("2026-10-15T21:33:20Z")
        );
        assert_eq!(
            normalize_reset_at(&json!("2026-10-15T08:00:00Z")).as_deref(),
            Some("2026-10-15T08:00:00Z")
        );
    }

    #[test]
    fn maps_duration_and_type_windows_consistently() {
        assert_eq!(
            window_from_duration_mins(300),
            Some(("5h".into(), "5h limit".into()))
        );
        assert_eq!(
            window_from_duration_mins(10_080),
            Some(("weekly".into(), "Weekly limit".into()))
        );
        assert_eq!(
            window_from_type("five_hour"),
            ("5h".into(), "5h limit".into(), None)
        );
        assert_eq!(
            window_from_type("seven_day_opus"),
            ("weekly".into(), "Weekly limit".into(), Some("Opus".into()))
        );
    }
}
