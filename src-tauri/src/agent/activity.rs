pub(crate) use super::activity_format::{
    MAX_DETAIL_CHARS, clean_detail, clean_summary, describe_changes, describe_thinking,
    describe_tool, thinking_summary,
};
use serde::Serialize;

const MAX_ACTIVITIES: usize = 32;
const MAX_ACTIVITY_ID: usize = 128;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ActivityKind {
    Thinking,
    Search,
    Read,
    Edit,
    Command,
    Other,
}

impl ActivityKind {
    pub fn from_tool(name: &str) -> Self {
        let name = name.to_ascii_lowercase();
        let has = |signals: &[&str]| signals.iter().any(|signal| name.contains(signal));
        if has(&["search", "grep", "glob", "fetch", "web", "browse"]) {
            Self::Search
        } else if has(&["bash", "shell", "exec", "command", "terminal", "run"]) {
            Self::Command
        } else if has(&[
            "edit", "write", "patch", "apply", "create", "delete", "move", "rename",
        ]) {
            Self::Edit
        } else if has(&["read", "view"]) || matches!(name.as_str(), "ls" | "list" | "cat") {
            Self::Read
        } else {
            Self::Other
        }
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ActivityDetails {
    pub summary: Option<String>,
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySnapshot {
    pub id: String,
    pub kind: ActivityKind,
    pub done: bool,
    pub summary: Option<String>,
    pub detail: Option<String>,
}

fn merge_details(item: &mut ActivitySnapshot, details: &ActivityDetails) -> bool {
    let mut changed = false;
    if let Some(summary) = details.summary.as_deref().and_then(clean_summary)
        && item.summary.as_deref() != Some(summary.as_str())
    {
        item.summary = Some(summary);
        changed = true;
    }
    if let Some(detail) = details.detail.as_deref().and_then(clean_detail)
        && item.detail.as_deref() != Some(detail.as_str())
    {
        item.detail = Some(detail);
        changed = true;
    }
    changed
}

pub fn start(
    list: &mut Vec<ActivitySnapshot>,
    id: &str,
    kind: ActivityKind,
    details: &ActivityDetails,
) -> bool {
    if id.is_empty() || id.len() > MAX_ACTIVITY_ID {
        return false;
    }
    if let Some(existing) = list.iter_mut().find(|item| item.id == id) {
        return merge_details(existing, details);
    }
    if list.len() >= MAX_ACTIVITIES {
        list.remove(0);
    }
    list.push(ActivitySnapshot {
        id: id.to_owned(),
        kind,
        done: false,
        summary: details.summary.as_deref().and_then(clean_summary),
        detail: details.detail.as_deref().and_then(clean_detail),
    });
    true
}

pub fn update(list: &mut [ActivitySnapshot], id: &str, details: &ActivityDetails) -> bool {
    match list.iter_mut().find(|item| item.id == id) {
        Some(item) => merge_details(item, details),
        None => false,
    }
}

pub fn append_detail(list: &mut [ActivitySnapshot], id: &str, delta: &str) -> bool {
    if delta.is_empty() {
        return false;
    }
    let Some(item) = list.iter_mut().find(|entry| entry.id == id) else {
        return false;
    };
    let normalized = delta.replace("\r\n", "\n").replace('\r', "\n");
    let cleaned: String = normalized
        .chars()
        .filter(|ch| !ch.is_control() || matches!(ch, '\n' | '\t'))
        .collect();
    if cleaned.is_empty() {
        return false;
    }
    let current = item.detail.get_or_insert_with(String::new);
    let current_chars = current.chars().count();
    if current_chars >= MAX_DETAIL_CHARS {
        return false;
    }
    let remaining = MAX_DETAIL_CHARS - current_chars;
    let mut incoming = cleaned.chars();
    let slice: String = incoming.by_ref().take(remaining).collect();
    if slice.is_empty() {
        return false;
    }
    current.push_str(&slice);
    if incoming.next().is_some() {
        let capped: String = current
            .chars()
            .take(MAX_DETAIL_CHARS.saturating_sub(1))
            .collect();
        *current = format!("{}…", capped.trim_end());
    }
    if item.kind == ActivityKind::Thinking {
        item.summary = thinking_summary(current);
    }
    true
}

pub fn finish(list: &mut [ActivitySnapshot], id: &str) -> bool {
    match list.iter_mut().find(|item| item.id == id && !item.done) {
        Some(item) => {
            item.done = true;
            true
        }
        None => false,
    }
}

pub fn finish_all(list: &mut [ActivitySnapshot]) -> bool {
    let mut changed = false;
    for item in list {
        if !item.done {
            item.done = true;
            changed = true;
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_names_map_to_generic_kinds() {
        assert_eq!(ActivityKind::from_tool("WebSearch"), ActivityKind::Search);
        assert_eq!(ActivityKind::from_tool("grep"), ActivityKind::Search);
        assert_eq!(ActivityKind::from_tool("Bash"), ActivityKind::Command);
        assert_eq!(ActivityKind::from_tool("apply_patch"), ActivityKind::Edit);
        assert_eq!(ActivityKind::from_tool("Read"), ActivityKind::Read);
        assert_eq!(ActivityKind::from_tool("ls"), ActivityKind::Read);
        assert_eq!(ActivityKind::from_tool("mystery"), ActivityKind::Other);
    }

    #[test]
    fn append_detail_streams_thinking_and_bounds_length() {
        let mut list = Vec::new();
        assert!(start(
            &mut list,
            "t1",
            ActivityKind::Thinking,
            &ActivityDetails::default()
        ));
        assert!(append_detail(&mut list, "t1", "**Checking layout**\n"));
        assert!(append_detail(&mut list, "t1", "Reading ActivityTrail.tsx"));
        assert_eq!(list[0].summary.as_deref(), Some("Checking layout"));
        assert_eq!(
            list[0].detail.as_deref(),
            Some("**Checking layout**\nReading ActivityTrail.tsx")
        );
        let huge = "a".repeat(MAX_DETAIL_CHARS + 100);
        assert!(append_detail(&mut list, "t1", &huge));
        assert!(!append_detail(&mut list, "t1", "ignored after cap"));
        assert!(list[0].detail.as_ref().unwrap().chars().count() <= MAX_DETAIL_CHARS);
    }

    #[test]
    fn list_merges_updates_for_same_id_and_stays_bounded() {
        let mut list = Vec::new();
        assert!(start(
            &mut list,
            "a",
            ActivityKind::Read,
            &ActivityDetails::default()
        ));
        assert!(!start(
            &mut list,
            "a",
            ActivityKind::Read,
            &ActivityDetails::default()
        ));
        assert!(start(
            &mut list,
            "a",
            ActivityKind::Read,
            &ActivityDetails {
                summary: Some("App.tsx".into()),
                detail: Some("Read\npath: src/App.tsx".into()),
            }
        ));
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].summary.as_deref(), Some("App.tsx"));
        assert!(!start(
            &mut list,
            "",
            ActivityKind::Read,
            &ActivityDetails::default()
        ));
        assert!(!start(
            &mut list,
            &"x".repeat(129),
            ActivityKind::Read,
            &ActivityDetails::default()
        ));
        assert!(!finish(&mut list, "missing"));
        assert!(finish(&mut list, "a"));
        assert!(!finish(&mut list, "a"));
        for index in 0..40 {
            start(
                &mut list,
                &format!("t{index}"),
                ActivityKind::Other,
                &ActivityDetails::default(),
            );
        }
        assert_eq!(list.len(), MAX_ACTIVITIES);
        assert_eq!(list.last().unwrap().id, "t39");
        assert!(finish_all(&mut list));
        assert!(list.iter().all(|entry| entry.done));
    }
}
