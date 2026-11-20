use super::stream::MAX_FRAME_BYTES;
use crate::agent::providers::{
    command_for_binary, job::Job, read_bounded_line, transport::JsonlProcess,
};
use crate::agent::{ModelOption, ProviderReadiness};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::time::timeout;

const AUTH_PROBE_TIMEOUT: Duration = Duration::from_secs(25);
const INITIALIZE_PROBE_TIMEOUT: Duration = Duration::from_secs(25);
const MAX_SETTINGS_BYTES: u64 = 1024 * 1024;
const INIT_REQUEST_ID: &str = "otto-claude-init";

pub(super) fn valid_claude_model_id(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('-')
        && value.len() <= 256
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.:/@".contains(&byte))
}

pub(super) fn valid_claude_effort(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('-')
        && value.len() <= 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
}

#[derive(Default)]
struct ClaudeSettings {
    configured_model: Option<String>,
    default_effort: Option<String>,
    model_efforts: HashMap<String, String>,
}

struct ClaudeCatalog {
    models: Vec<ModelOption>,
    aliases: HashMap<String, String>,
    default_model: Option<String>,
}

impl ClaudeCatalog {
    fn resolve<'a>(&'a self, name: &'a str) -> &'a str {
        self.aliases.get(name).map(String::as_str).unwrap_or(name)
    }
}

fn claude_settings_path() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR").filter(|value| !value.is_empty()) {
        return Some(PathBuf::from(dir).join("settings.json"));
    }
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    Some(PathBuf::from(home).join(".claude").join("settings.json"))
}

fn parse_claude_settings(value: &Value) -> ClaudeSettings {
    let configured_model = value["model"]
        .as_str()
        .map(str::trim)
        .filter(|id| valid_claude_model_id(id))
        .map(str::to_owned);
    let default_effort = value["effortLevel"]
        .as_str()
        .map(str::trim)
        .filter(|effort| valid_claude_effort(effort))
        .map(str::to_owned);
    let mut model_efforts = HashMap::new();
    if let Some(entries) = value["modelSettings"].as_object() {
        for (model_id, config) in entries {
            if valid_claude_model_id(model_id)
                && let Some(effort) = config["effortLevel"]
                    .as_str()
                    .map(str::trim)
                    .filter(|level| valid_claude_effort(level))
            {
                model_efforts.insert(model_id.clone(), effort.to_owned());
            }
        }
    }
    ClaudeSettings {
        configured_model,
        default_effort,
        model_efforts,
    }
}

fn load_native_settings() -> ClaudeSettings {
    let Some(path) = claude_settings_path() else {
        return ClaudeSettings::default();
    };
    let Ok(metadata) = std::fs::metadata(&path) else {
        return ClaudeSettings::default();
    };
    if !metadata.is_file() || metadata.len() > MAX_SETTINGS_BYTES {
        return ClaudeSettings::default();
    }
    let Ok(raw) = std::fs::read_to_string(path) else {
        return ClaudeSettings::default();
    };
    serde_json::from_str::<Value>(&raw)
        .map(|value| parse_claude_settings(&value))
        .unwrap_or_default()
}

fn supported_efforts(entry: &Value) -> Vec<String> {
    if entry["supportsEffort"] == false {
        return Vec::new();
    }
    let mut efforts = Vec::new();
    for item in entry["supportedEffortLevels"]
        .as_array()
        .into_iter()
        .flatten()
    {
        if let Some(level) = item.as_str().filter(|value| valid_claude_effort(value))
            && !efforts.iter().any(|existing| existing == level)
        {
            efforts.push(level.to_owned());
        }
    }
    efforts
}

fn parse_initialize_catalog(response: &Value, settings: &ClaudeSettings) -> ClaudeCatalog {
    let mut models: Vec<ModelOption> = Vec::new();
    let mut default_labelled: Vec<bool> = Vec::new();
    let mut aliases: HashMap<String, String> = HashMap::new();
    let mut default_model: Option<String> = None;
    for entry in response["models"].as_array().into_iter().flatten() {
        let alias = entry["value"]
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let canonical = entry["resolvedModel"]
            .as_str()
            .map(str::trim)
            .filter(|value| valid_claude_model_id(value))
            .or_else(|| alias.filter(|value| valid_claude_model_id(value)));
        let Some(id) = canonical else {
            continue;
        };
        let is_default_entry = alias == Some("default");
        if let Some(alias_name) = alias {
            aliases.insert(alias_name.to_owned(), id.to_owned());
        }
        if is_default_entry && default_model.is_none() {
            default_model = Some(id.to_owned());
        }
        let display_name = entry["displayName"]
            .as_str()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or(id)
            .to_owned();
        let context_window = entry["contextWindow"].as_i64().filter(|count| *count > 0);
        let efforts = supported_efforts(entry);
        let preferred_effort = settings
            .model_efforts
            .get(id)
            .or_else(|| alias.and_then(|name| settings.model_efforts.get(name)))
            .or(settings.default_effort.as_ref())
            .filter(|effort| efforts.iter().any(|candidate| candidate == *effort))
            .cloned();
        if let Some(index) = models.iter().position(|existing| existing.id == id) {
            if default_labelled[index] && !is_default_entry {
                models[index].display_name = display_name;
                default_labelled[index] = false;
            }
            if models[index].context_window.is_none() {
                models[index].context_window = context_window;
            }
            if models[index].thinking_efforts.is_empty() && !efforts.is_empty() {
                models[index].thinking_efforts = efforts;
            }
            if models[index].default_thinking_effort.is_none() {
                models[index].default_thinking_effort = preferred_effort;
            }
            continue;
        }
        models.push(ModelOption {
            id: id.to_owned(),
            display_name,
            context_window,
            image_input: true,
            thinking_efforts: efforts,
            default_thinking_effort: preferred_effort,
        });
        default_labelled.push(is_default_entry);
    }
    ClaudeCatalog {
        models,
        aliases,
        default_model,
    }
}

fn apply_catalog(
    mut readiness: ProviderReadiness,
    catalog: Option<ClaudeCatalog>,
    settings: &ClaudeSettings,
    requested_model: Option<&str>,
) -> ProviderReadiness {
    let Some(catalog) = catalog.filter(|parsed| !parsed.models.is_empty()) else {
        return readiness;
    };
    let selected = if let Some(requested) = requested_model.filter(|value| !value.is_empty()) {
        let resolved = catalog.resolve(requested);
        let Some(option) = catalog
            .models
            .iter()
            .find(|option| option.id == requested || option.id == resolved)
        else {
            let mut unsupported = ProviderReadiness::new(
                "unsupported",
                "Claude Code selected model is not available in the current Claude Code configuration.",
                "Choose an available model below, then Retry.",
            );
            unsupported.models = catalog.models;
            return unsupported;
        };
        Some(option.clone())
    } else {
        let configured = settings
            .configured_model
            .as_deref()
            .map(|name| catalog.resolve(name))
            .and_then(|id| catalog.models.iter().find(|option| option.id == id));
        configured
            .or_else(|| {
                catalog
                    .default_model
                    .as_deref()
                    .and_then(|id| catalog.models.iter().find(|option| option.id == id))
            })
            .or_else(|| catalog.models.first())
            .cloned()
    };
    if let Some(active) = selected {
        readiness.model = Some(active.id);
        readiness.thinking_efforts = active.thinking_efforts;
        readiness.thinking_effort = active.default_thinking_effort;
    }
    readiness.models = catalog.models;
    readiness
}

pub(in crate::agent::providers) fn executable() -> Option<PathBuf> {
    crate::agent::providers::find_executable(&["claude.exe", "claude.cmd", "claude.bat"])
}

async fn probe_auth(binary: &Path, cwd: &Path) -> ProviderReadiness {
    let mut command = command_for_binary(binary);
    command.args(["auth", "status", "--json"]).current_dir(cwd);
    match Job::probe(command, AUTH_PROBE_TIMEOUT).await {
        Ok(output) if output.status.success() => {
            let mut ready = ProviderReadiness::new(
                "ready",
                "Claude Code is signed in; its native settings are active.",
                "",
            );
            ready.image_input = true;
            ready
        }
        Ok(output) if output.status.code() == Some(1) => ProviderReadiness::new(
            "authRequired",
            "Claude Code needs sign-in.",
            "Run claude auth login, then Retry.",
        ),
        _ => ProviderReadiness::new(
            "unavailable",
            "Claude Code authentication could not be verified.",
            "Check the Claude Code installation and native configuration, then Retry.",
        ),
    }
}

async fn probe_initialize_response(binary: &Path, cwd: &Path) -> Option<Value> {
    let args = [
        "-p",
        "--output-format",
        "stream-json",
        "--input-format",
        "stream-json",
        "--verbose",
        "--no-session-persistence",
    ];
    let (mut process, _) = JsonlProcess::launch(
        "Claude Code",
        binary,
        args,
        cwd,
        false,
        "Claude Code could not start.",
    )
    .ok()?;
    let request = serde_json::to_vec(&json!({
        "type": "control_request",
        "request_id": INIT_REQUEST_ID,
        "request": { "subtype": "initialize" }
    }))
    .ok()?;
    let payload = timeout(INITIALIZE_PROBE_TIMEOUT, async {
        process.send_line(request, "disconnected").await.ok()?;
        while let Ok(Some(line)) = read_bounded_line(process.reader(), MAX_FRAME_BYTES).await {
            let Ok(frame) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if frame["type"] == "control_response"
                && frame["response"]["request_id"] == INIT_REQUEST_ID
            {
                if frame["response"]["subtype"] == "success" {
                    return Some(frame["response"]["response"].clone());
                }
                return None;
            }
        }
        None
    })
    .await
    .ok()
    .flatten();
    process.terminate_tree().await;
    payload
}

pub(in crate::agent::providers) async fn readiness(
    cwd: &Path,
    requested_model: Option<&str>,
) -> ProviderReadiness {
    let Some(binary) = executable() else {
        return ProviderReadiness::new(
            "missing",
            "Claude Code was not found in PATH.",
            "Install Claude Code and restart Otto, then Retry.",
        );
    };
    let auth_fut = probe_auth(&binary, cwd);
    let init_fut = probe_initialize_response(&binary, cwd);
    tokio::pin!(auth_fut);
    tokio::pin!(init_fut);
    let (auth, init_response) = tokio::select! {
        auth = &mut auth_fut => {
            if auth.status != "ready" {
                return auth;
            }
            let init = init_fut.await;
            (auth, init)
        }
        init = &mut init_fut => {
            let auth = auth_fut.await;
            if auth.status != "ready" {
                return auth;
            }
            (auth, init)
        }
    };
    let settings = load_native_settings();
    let catalog = init_response
        .as_ref()
        .map(|payload| parse_initialize_catalog(payload, &settings));
    apply_catalog(auth, catalog, &settings, requested_model)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_initialize_response() -> Value {
        json!({
            "models": [
                {
                    "value": "default",
                    "resolvedModel": "claude-opus-5-5",
                    "displayName": "Default (recommended)",
                    "supportsEffort": true,
                    "supportedEffortLevels": ["low", "medium", "high", "xhigh", "max"]
                },
                {
                    "value": "opus",
                    "resolvedModel": "claude-opus-5-5",
                    "displayName": "Opus 5.5",
                    "supportsEffort": true,
                    "supportedEffortLevels": ["low", "medium", "high", "xhigh", "max"]
                },
                {
                    "value": "sonnet",
                    "resolvedModel": "claude-sonnet-5-5",
                    "displayName": "Sonnet 5.5",
                    "supportsEffort": true,
                    "supportedEffortLevels": ["low", "medium", "high", "xhigh", "max"]
                },
                {
                    "value": "claude-haiku-4-5-20251001",
                    "resolvedModel": "claude-haiku-4-5-20251001",
                    "displayName": "Haiku 4.5",
                    "supportsThinkingOff": true
                },
                {
                    "value": "claude-opus-4-6",
                    "resolvedModel": "claude-opus-4-6",
                    "displayName": "Opus 4.6",
                    "supportsEffort": true,
                    "supportedEffortLevels": ["low", "medium", "high", "max"]
                }
            ]
        })
    }

    #[test]
    fn claude_initialize_catalog_deduplicates_default_resolves_aliases_and_preserves_efforts() {
        let settings = parse_claude_settings(&json!({
            "model": "sonnet",
            "modelSettings": {
                "claude-sonnet-5-5": { "effortLevel": "high" }
            }
        }));
        let catalog = parse_initialize_catalog(&sample_initialize_response(), &settings);
        let ready = apply_catalog(
            ProviderReadiness::new("ready", "Claude Code is signed in.", ""),
            Some(catalog),
            &settings,
            None,
        );
        assert_eq!(ready.status, "ready");
        assert_eq!(ready.model.as_deref(), Some("claude-sonnet-5-5"));
        assert_eq!(ready.thinking_effort.as_deref(), Some("high"));
        assert_eq!(
            ready.thinking_efforts,
            vec!["low", "medium", "high", "xhigh", "max"]
        );
        assert_eq!(ready.models.len(), 4);
        assert_eq!(ready.models[0].id, "claude-opus-5-5");
        assert_eq!(ready.models[0].display_name, "Opus 5.5");
        assert!(ready.models[2].thinking_efforts.is_empty());
        assert_eq!(
            ready.models[3].thinking_efforts,
            vec!["low", "medium", "high", "max"]
        );
        assert!(ready.models.iter().all(|model| model.image_input));
    }

    #[test]
    fn claude_readiness_preserves_catalog_when_requested_model_is_unavailable() {
        let settings = ClaudeSettings::default();
        let catalog = parse_initialize_catalog(&sample_initialize_response(), &settings);
        let result = apply_catalog(
            ProviderReadiness::new("ready", "Claude Code is signed in.", ""),
            Some(catalog),
            &settings,
            Some("claude-unknown-9"),
        );
        assert_eq!(result.status, "unsupported");
        assert_eq!(result.models.len(), 4);
        assert!(result.model.is_none());
    }

    #[test]
    fn claude_readiness_falls_back_cleanly_when_initialize_returns_no_models() {
        let settings = ClaudeSettings::default();
        let result = apply_catalog(
            ProviderReadiness::new("ready", "Claude Code is signed in.", ""),
            None,
            &settings,
            None,
        );
        assert_eq!(result.status, "ready");
        assert!(result.models.is_empty());
        assert!(result.model.is_none());
    }

    #[test]
    fn claude_model_and_effort_validators_reject_flags_and_metacharacters() {
        assert!(valid_claude_model_id("claude-sonnet-5-5"));
        assert!(valid_claude_model_id("claude-haiku-4-5-20251001"));
        assert!(!valid_claude_model_id(""));
        assert!(!valid_claude_model_id("--dangerously-skip-permissions"));
        assert!(!valid_claude_model_id("sonnet&whoami"));
        assert!(!valid_claude_model_id("sonnet model"));
        assert!(valid_claude_effort("xhigh"));
        assert!(!valid_claude_effort(""));
        assert!(!valid_claude_effort("-p"));
        assert!(!valid_claude_effort("high&calc"));
    }
}
