use super::rpc::Rpc;
use crate::agent::ProviderId;
use crate::agent::{CaptureSnapshot, ModelOption, ProviderReadiness, RunPhase, Snapshot};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::{sync::watch, time::timeout};

pub(in crate::agent::providers) fn executable() -> Option<PathBuf> {
    crate::agent::providers::find_executable(&["codex.exe", "codex.cmd"])
}

pub(super) fn account_readiness(value: &Value) -> ProviderReadiness {
    let account = &value["account"];
    if account.is_null() {
        return if value["requiresOpenaiAuth"] == true {
            ProviderReadiness::new(
                "authRequired",
                "Codex needs sign-in.",
                "Run codex login, then Retry.",
            )
        } else if value["requiresOpenaiAuth"] == false {
            ProviderReadiness::new("ready", "Codex does not require OpenAI sign-in.", "")
        } else {
            ProviderReadiness::new(
                "unsupported",
                "Codex did not report whether authentication is required.",
                "Update Codex or check its provider configuration, then Retry.",
            )
        };
    }
    match account["type"].as_str() {
        Some("chatgpt" | "apiKey" | "apikey" | "amazonBedrock" | "gcp") => {
            ProviderReadiness::new("ready", "Codex account is configured.", "")
        }
        _ => ProviderReadiness::new(
            "unsupported",
            "Codex returned an unrecognized account type.",
            "Update Codex, then Retry.",
        ),
    }
}

pub(super) fn account_read_request() -> Value {
    json!({ "refreshToken": false })
}

pub(super) fn model_id(value: &Value) -> Option<&str> {
    value["model"]
        .as_str()
        .or_else(|| value["id"].as_str())
        .filter(|value| !value.trim().is_empty())
}

pub(super) fn reasoning_efforts(value: &Value) -> Vec<String> {
    value["supportedReasoningEfforts"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|effort| {
            effort["reasoningEffort"]
                .as_str()
                .or_else(|| effort.as_str())
        })
        .map(str::to_owned)
        .collect()
}

pub(super) fn model_option(value: &Value) -> Option<ModelOption> {
    let id = model_id(value)?.to_owned();
    let thinking_efforts = reasoning_efforts(value);
    Some(ModelOption {
        id,
        display_name: value["displayName"]
            .as_str()
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| model_id(value).unwrap_or("Unknown model"))
            .to_owned(),
        context_window: value["contextWindow"].as_i64().filter(|count| *count > 0),
        image_input: value["inputModalities"]
            .as_array()
            .is_some_and(|items| items.iter().any(|item| item == "image")),
        default_thinking_effort: value["defaultReasoningEffort"].as_str().map(str::to_owned),
        thinking_efforts,
    })
}

pub(super) fn model_options_for_selection(
    value: &Value,
    selected: Option<&str>,
) -> Vec<ModelOption> {
    value["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|item| {
            item["hidden"] != true || selected.is_some_and(|id| model_id(item) == Some(id))
        })
        .filter_map(model_option)
        .collect()
}

pub(super) fn model_options(value: &Value) -> Vec<ModelOption> {
    model_options_for_selection(value, None)
}

pub(super) fn with_models(
    mut readiness: ProviderReadiness,
    models: Vec<ModelOption>,
) -> ProviderReadiness {
    readiness.models = models;
    readiness
}

#[cfg(test)]
pub(super) fn model_readiness(value: &Value, configured: Option<&str>) -> ProviderReadiness {
    model_readiness_with_config(value, configured, None, None)
}

pub(super) fn model_readiness_with_config(
    value: &Value,
    configured: Option<&str>,
    configured_effort: Option<&str>,
    configured_window: Option<i64>,
) -> ProviderReadiness {
    let Some(catalog) = value["data"].as_array() else {
        return ProviderReadiness::new(
            "unsupported",
            "Codex model catalog is unavailable.",
            "Update Codex, then Retry.",
        );
    };
    let selected = configured.filter(|name| !name.is_empty());
    let mut models = model_options_for_selection(value, selected);
    let model = if let Some(name) = selected {
        catalog.iter().find(|m| model_id(m) == Some(name))
    } else {
        catalog
            .iter()
            .find(|m| m["isDefault"] == true && m["hidden"] != true)
    };
    let Some(model) = model else {
        return with_models(
            ProviderReadiness::new(
                "unsupported",
                "Codex could not verify the configured model.",
                "Choose an available model below, then Retry.",
            ),
            models,
        );
    };
    let modalities = match model.get("inputModalities") {
        None => None,
        Some(Value::Array(items)) => Some(items),
        _ => {
            return with_models(
                ProviderReadiness::new(
                    "unsupported",
                    "Codex returned invalid model input capabilities.",
                    "Choose another available model below, then Retry.",
                ),
                models,
            );
        }
    };

    let text = modalities.is_none_or(|items| items.iter().any(|v| v == "text"));
    if !text {
        return with_models(
            ProviderReadiness::new(
                "unsupported",
                "Codex's selected model does not support text.",
                "Choose another available model below, then Retry.",
            ),
            models,
        );
    }
    let selected_option = model_option(model);
    let selected_id = model_id(model).map(str::to_owned);
    let efforts = selected_option
        .as_ref()
        .map(|option| option.thinking_efforts.clone())
        .unwrap_or_default();
    let effective_effort = configured_effort
        .filter(|effort| efforts.iter().any(|supported| supported == effort))
        .map(str::to_owned)
        .or_else(|| {
            selected_option
                .as_ref()
                .and_then(|option| option.default_thinking_effort.clone())
        });
    if let Some(id) = selected_id.as_deref()
        && let Some(option) = models.iter_mut().find(|item| item.id == id)
    {
        if effective_effort.is_some() {
            option.default_thinking_effort = effective_effort.clone();
        }
        if option.context_window.is_none() {
            option.context_window = configured_window.filter(|count| *count > 0);
        }
    }
    let mut ready = ProviderReadiness::new("ready", "Codex is ready for text requests.", "");
    ready.image_input = modalities.is_some_and(|items| items.iter().any(|v| v == "image"));
    ready.model = selected_id;
    ready.models = models;
    ready.thinking_effort = effective_effort;
    ready.thinking_efforts = efforts;
    ready
}

pub(super) struct ConfiguredRuntime<'a> {
    pub model: Option<&'a str>,
    pub reasoning_effort: Option<&'a str>,
    pub context_window: Option<i64>,
}

pub(super) fn configured_runtime(
    value: &Value,
) -> Result<ConfiguredRuntime<'_>, Box<ProviderReadiness>> {
    let model = configured_model(value)?;
    let config = value.get("config").and_then(Value::as_object);
    let reasoning_effort = config
        .and_then(|map| {
            map.get("model_reasoning_effort")
                .or_else(|| map.get("reasoning_effort"))
        })
        .and_then(Value::as_str)
        .filter(|effort| !effort.trim().is_empty());
    let context_window = config
        .and_then(|map| map.get("model_context_window"))
        .and_then(Value::as_i64)
        .filter(|count| *count > 0);
    Ok(ConfiguredRuntime {
        model,
        reasoning_effort,
        context_window,
    })
}

pub(super) fn configured_model(value: &Value) -> Result<Option<&str>, Box<ProviderReadiness>> {
    let Some(config) = value.get("config").and_then(Value::as_object) else {
        return Err(Box::new(ProviderReadiness::new(
            "unsupported",
            "Codex did not return effective model configuration.",
            "Choose an available model below, then Retry.",
        )));
    };
    match config.get("model") {
        Some(Value::Null) => Ok(None),
        Some(Value::String(name)) if !name.trim().is_empty() => Ok(Some(name.as_str())),
        _ => Err(Box::new(ProviderReadiness::new(
            "unsupported",
            "Codex returned an invalid model configuration.",
            "Choose an available model below, then Retry.",
        ))),
    }
}

pub(in crate::agent::providers) async fn readiness(
    cwd: &Path,
    requested_model: Option<&str>,
) -> ProviderReadiness {
    if executable().is_none() {
        return ProviderReadiness::new(
            "missing",
            "Codex CLI was not found in PATH.",
            "Install Codex CLI, then Retry.",
        );
    }
    let Ok(mut rpc) = Rpc::launch(cwd) else {
        return ProviderReadiness::new(
            "unavailable",
            "Codex App Server could not start.",
            "Check your Codex installation, then Retry.",
        );
    };
    let result = timeout(Duration::from_secs(12), async {
        let (_updates, _) = watch::channel(Snapshot {
            run_id: 0,
            seq: 0,
            status: RunPhase::Idle,
            provider: ProviderId::Codex,
            cwd: String::new(),
            conversation_id: String::new(),
            thread_id: None,
            model: None,
            thinking_effort: None,
            usage: None,
            rate_limits: Vec::new(),
            messages: Vec::new(),
            activity: Vec::new(),
            capture: CaptureSnapshot::default(),
            queued_followup: None,
            pending_permission: None,
            turn_timing: None,
            error: None,
        });
        rpc.request(
            "initialize",
            json!({ "clientInfo": { "name": "otto", "title": "Otto", "version": env!("CARGO_PKG_VERSION") } }),
        )
        .await?;
        rpc.send(json!({ "method": "initialized", "params": {} }))
            .await?;
        let (account, _) = rpc.request("account/read", account_read_request()).await?;
        let authentication = account_readiness(&account);
        if authentication.status != "ready" {
            return Ok::<ProviderReadiness, String>(authentication);
        }

        let (models, _) = rpc
            .request("model/list", json!({ "limit": 100, "includeHidden": true }))
            .await?;
        let (config, _) = rpc
            .request(
                "config/read",
                json!({ "cwd": cwd.to_string_lossy(), "includeLayers": false }),
            )
            .await?;
        let runtime = match configured_runtime(&config) {
            Ok(runtime) => runtime,
            Err(status) if requested_model.is_none() => {
                return Ok::<ProviderReadiness, String>(with_models(
                    *status,
                    model_options(&models),
                ));
            }
            Err(_) => ConfiguredRuntime {
                model: None,
                reasoning_effort: None,
                context_window: None,
            },
        };
        let selected = requested_model.or(runtime.model);
        let apply_config_effort = requested_model.is_none() || requested_model == runtime.model;
        let mut ready = model_readiness_with_config(
            &models,
            selected,
            apply_config_effort
                .then_some(runtime.reasoning_effort)
                .flatten(),
            runtime.context_window,
        );
        if ready.status == "ready"
            && let Ok(Ok((limits, _))) = timeout(
                Duration::from_millis(1_500),
                rpc.request("account/rateLimits/read", Value::Null),
            )
            .await
        {
            ready.rate_limits = super::rate_limits::parse_rate_limits(&limits);
        }
        Ok::<ProviderReadiness, String>(ready)
    })
    .await;
    rpc.terminate().await;
    match result {
        Ok(Ok(readiness)) => readiness,
        Ok(Err(_)) => ProviderReadiness::new(
            "unavailable",
            "Codex could not verify authentication or model capabilities.",
            "Check Codex sign-in and connectivity, then Retry.",
        ),
        Err(_) => ProviderReadiness::new(
            "unavailable",
            "Codex readiness check timed out.",
            "Retry after checking your Codex connection.",
        ),
    }
}

pub(in crate::agent::providers) async fn probe_rate_limits(
    cwd: &Path,
) -> Vec<crate::agent::ProviderRateLimit> {
    if executable().is_none() {
        return Vec::new();
    }
    let Ok(mut rpc) = Rpc::launch(cwd) else {
        return Vec::new();
    };
    let result = timeout(Duration::from_secs(6), async {
        rpc.request(
            "initialize",
            json!({ "clientInfo": { "name": "otto", "title": "Otto", "version": env!("CARGO_PKG_VERSION") } }),
        )
        .await?;
        rpc.send(json!({ "method": "initialized", "params": {} }))
            .await?;
        let (limits, _) = rpc.request("account/rateLimits/read", Value::Null).await?;
        Ok::<Vec<crate::agent::ProviderRateLimit>, String>(super::rate_limits::parse_rate_limits(
            &limits,
        ))
    })
    .await;
    rpc.terminate().await;
    result.ok().and_then(Result::ok).unwrap_or_default()
}
