use crate::agent::activity::{clean_detail, clean_summary, describe_tool};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::Duration;

pub(crate) const PERMISSION_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_SUMMARY_CHARS: usize = 220;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingPermissionSnapshot {
    pub request_id: String,
    pub run_id: u64,
    pub engine: String,
    pub title: String,
    pub summary: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PermissionDecision {
    AllowOnce,
    Decline,
}

pub(crate) struct AcpPermissionPrompt {
    pub snapshot: PendingPermissionSnapshot,
    pub allow_option_id: Option<String>,
    pub reject_option_id: Option<String>,
}

fn rpc_id_token(id: &Value) -> Option<String> {
    if let Some(num) = id.as_u64() {
        Some(num.to_string())
    } else if let Some(num) = id.as_i64() {
        Some(num.to_string())
    } else {
        id.as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty() && value.len() <= 128)
            .map(str::to_owned)
    }
}

fn bounded_summary(raw: &str) -> String {
    let cleaned = clean_detail(raw).unwrap_or_default();
    let single_line: String = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    if single_line.is_empty() {
        return "This engine wants confirmation before continuing an action.".into();
    }
    let count = single_line.chars().count();
    if count <= MAX_SUMMARY_CHARS {
        single_line
    } else {
        let prefix: String = single_line
            .chars()
            .take(MAX_SUMMARY_CHARS.saturating_sub(1))
            .collect();
        format!("{prefix}…")
    }
}

pub(crate) fn acp_permission_request(
    engine: &str,
    run_id: u64,
    frame: &Value,
) -> Option<AcpPermissionPrompt> {
    if frame["method"].as_str() != Some("session/request_permission") {
        return None;
    }
    let rpc_token = rpc_id_token(frame.get("id")?)?;
    let params = &frame["params"];
    let tool = &params["toolCall"];
    let title = tool["title"]
        .as_str()
        .and_then(clean_summary)
        .unwrap_or_else(|| "Action confirmation".into());
    let details = describe_tool(
        tool["kind"].as_str().unwrap_or_default(),
        tool["title"].as_str(),
        tool.get("rawInput"),
        &[],
    );
    let summary = bounded_summary(
        details
            .detail
            .as_deref()
            .or(details.summary.as_deref())
            .unwrap_or(&title),
    );

    let mut allow_option_id = None;
    let mut reject_option_id = None;
    for option in params["options"].as_array().into_iter().flatten() {
        let Some(option_id) = option["optionId"]
            .as_str()
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        match option["kind"].as_str() {
            Some("allow_once") if allow_option_id.is_none() => {
                allow_option_id = Some(option_id.to_owned());
            }
            Some("reject_once") if reject_option_id.is_none() => {
                reject_option_id = Some(option_id.to_owned());
            }
            Some("reject_always") if reject_option_id.is_none() => {
                reject_option_id = Some(option_id.to_owned());
            }
            _ => {}
        }
    }

    Some(AcpPermissionPrompt {
        snapshot: PendingPermissionSnapshot {
            request_id: format!("acp:{run_id}:{rpc_token}"),
            run_id,
            engine: engine.to_owned(),
            title,
            summary,
        },
        allow_option_id,
        reject_option_id,
    })
}

pub(crate) fn acp_permission_reply(
    rpc_id: &Value,
    decision: PermissionDecision,
    allow_option_id: Option<&str>,
    reject_option_id: Option<&str>,
) -> Value {
    let outcome = match decision {
        PermissionDecision::AllowOnce => match allow_option_id {
            Some(option_id) => json!({ "outcome": "selected", "optionId": option_id }),
            None => json!({ "outcome": "cancelled" }),
        },
        PermissionDecision::Decline => match reject_option_id {
            Some(option_id) => json!({ "outcome": "selected", "optionId": option_id }),
            None => json!({ "outcome": "cancelled" }),
        },
    };
    json!({
        "jsonrpc": "2.0",
        "id": rpc_id,
        "result": { "outcome": outcome }
    })
}

pub(crate) fn codex_permission_request(
    run_id: u64,
    frame: &Value,
) -> Option<PendingPermissionSnapshot> {
    let method = frame["method"].as_str()?;
    let lower = method.to_ascii_lowercase();
    if !lower.contains("approval") && !lower.contains("permission") {
        return None;
    }
    let rpc_token = rpc_id_token(frame.get("id")?)?;
    let params = &frame["params"];
    let title = if lower.contains("command") || lower.contains("exec") {
        "Run a command".to_owned()
    } else if lower.contains("file") || lower.contains("patch") {
        "Modify a file".to_owned()
    } else {
        "Action confirmation".to_owned()
    };
    let command = params["command"]
        .as_str()
        .map(str::to_owned)
        .or_else(|| {
            params["command"].as_array().map(|parts| {
                parts
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(" ")
            })
        })
        .or_else(|| params["parsedCmd"].as_str().map(str::to_owned));
    let raw_summary = params["reason"]
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .or(command)
        .or_else(|| {
            params["filePath"]
                .as_str()
                .or_else(|| params["path"].as_str())
                .map(str::to_owned)
        })
        .unwrap_or_else(|| format!("Codex requested permission ({title})."));

    Some(PendingPermissionSnapshot {
        request_id: format!("codex:{run_id}:{rpc_token}"),
        run_id,
        engine: "Codex".into(),
        title,
        summary: bounded_summary(&raw_summary),
    })
}

pub(crate) fn codex_permission_reply(rpc_id: &Value, decision: PermissionDecision) -> Value {
    let verdict = match decision {
        PermissionDecision::AllowOnce => "accept",
        PermissionDecision::Decline => "decline",
    };
    json!({
        "id": rpc_id,
        "result": { "decision": verdict }
    })
}

pub(crate) fn unsupported_host_request_reply(rpc_id: &Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": rpc_id,
        "error": {
            "code": -32601,
            "message": "Host request declined by Otto."
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acp_permission_parses_options_and_never_auto_approves_on_decline() {
        let frame = json!({
            "jsonrpc": "2.0",
            "id": 99,
            "method": "session/request_permission",
            "params": {
                "toolCall": {
                    "title": "Run shell command",
                    "kind": "execute",
                    "rawInput": { "command": "dir", "token": "secret-val" }
                },
                "options": [
                    { "optionId": "allow-1", "kind": "allow_once", "name": "Allow once" },
                    { "optionId": "reject-1", "kind": "reject_once", "name": "Reject once" }
                ]
            }
        });
        let prompt = acp_permission_request("Agy", 10, &frame).expect("parsed prompt");
        assert_eq!(prompt.snapshot.request_id, "acp:10:99");
        assert_eq!(prompt.snapshot.engine, "Agy");
        assert!(!prompt.snapshot.summary.contains("secret-val"));

        let decline = acp_permission_reply(
            &frame["id"],
            PermissionDecision::Decline,
            prompt.allow_option_id.as_deref(),
            prompt.reject_option_id.as_deref(),
        );
        assert_eq!(decline["result"]["outcome"]["outcome"], "selected");
        assert_eq!(decline["result"]["outcome"]["optionId"], "reject-1");

        let allow = acp_permission_reply(
            &frame["id"],
            PermissionDecision::AllowOnce,
            prompt.allow_option_id.as_deref(),
            prompt.reject_option_id.as_deref(),
        );
        assert_eq!(allow["result"]["outcome"]["optionId"], "allow-1");

        let no_allow_option = acp_permission_reply(
            &frame["id"],
            PermissionDecision::AllowOnce,
            None,
            prompt.reject_option_id.as_deref(),
        );
        assert_eq!(no_allow_option["result"]["outcome"]["outcome"], "cancelled");
    }

    #[test]
    fn codex_permission_recognizes_approval_methods_and_rejects_unknown_requests() {
        let approval = json!({
            "id": 42,
            "method": "item/commandExecution/requestApproval",
            "params": { "command": ["git", "status"], "reason": "Check repository status" }
        });
        let prompt = codex_permission_request(5, &approval).expect("parsed codex approval");
        assert_eq!(prompt.request_id, "codex:5:42");
        assert_eq!(prompt.title, "Run a command");
        assert!(prompt.summary.contains("Check repository status"));

        let declined = codex_permission_reply(&approval["id"], PermissionDecision::Decline);
        assert_eq!(declined["result"]["decision"], "decline");
        let allowed = codex_permission_reply(&approval["id"], PermissionDecision::AllowOnce);
        assert_eq!(allowed["result"]["decision"], "accept");

        let unknown = json!({ "id": 7, "method": "fs/readTextFile", "params": {} });
        assert!(codex_permission_request(5, &unknown).is_none());
        let error_reply = unsupported_host_request_reply(&unknown["id"]);
        assert_eq!(error_reply["error"]["code"], -32601);
    }
}
