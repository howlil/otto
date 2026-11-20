use super::{
    admission::admit_session,
    client::{AcpClient, STARTUP_TIMEOUT, executable},
    spec::AcpSpec,
};
use crate::agent::{ModelOption, ProviderReadiness};
use serde_json::{Value, json};
use std::path::Path;

pub(super) struct ThinkingConfig {
    pub config_id: String,
    pub current: Option<String>,
    pub options: Vec<String>,
}

fn config_option<'a>(value: &'a Value, category: &str) -> Option<&'a Value> {
    value["configOptions"]
        .as_array()?
        .iter()
        .find(|option| option["category"] == category || option["id"] == category)
}

pub(super) fn model_config_id(value: &Value) -> Option<String> {
    config_option(value, "model")?["id"]
        .as_str()
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
}

pub(super) fn thinking_config(value: &Value) -> Option<ThinkingConfig> {
    let option = config_option(value, "thought_level")
        .or_else(|| config_option(value, "reasoning_effort"))?;
    let config_id = option["id"]
        .as_str()
        .filter(|id| !id.is_empty())?
        .to_owned();
    let mut options = Vec::new();
    for entry in option["options"].as_array().into_iter().flatten() {
        let Some(val) = entry["value"]
            .as_str()
            .filter(|v| !v.is_empty() && v.len() <= 32)
        else {
            continue;
        };
        if !options.iter().any(|existing| existing == val) {
            options.push(val.to_owned());
        }
    }
    if options.is_empty() {
        return None;
    }
    let current = option["currentValue"]
        .as_str()
        .filter(|val| options.iter().any(|existing| existing == val))
        .map(str::to_owned)
        .or_else(|| options.first().cloned());
    Some(ThinkingConfig {
        config_id,
        current,
        options,
    })
}

pub(super) async fn apply_runtime_options(
    client: &mut AcpClient,
    session_id: &str,
    model_cfg: Option<&str>,
    thought_cfg: &mut Option<String>,
    model: Option<&str>,
    thinking_effort: Option<&str>,
) -> Result<(), String> {
    if let Some(model) = model.filter(|value| !value.is_empty()) {
        if let Some(config_id) = model_cfg {
            let (updated, _) = client
                .request(
                    "session/set_config_option",
                    json!({ "sessionId": session_id, "configId": config_id, "value": model }),
                    STARTUP_TIMEOUT,
                )
                .await?;
            *thought_cfg = thinking_config(&updated).map(|cfg| cfg.config_id);
        } else {
            client
                .request(
                    "session/set_model",
                    json!({ "sessionId": session_id, "modelId": model }),
                    STARTUP_TIMEOUT,
                )
                .await?;
        }
    }
    if let Some(effort) = thinking_effort.filter(|value| !value.is_empty())
        && let Some(config_id) = thought_cfg.as_deref()
    {
        client
            .request(
                "session/set_config_option",
                json!({ "sessionId": session_id, "configId": config_id, "value": effort }),
                STARTUP_TIMEOUT,
            )
            .await?;
    }
    Ok(())
}

fn model_context_window(model: &Value, fallback: Option<i64>) -> Option<i64> {
    model["contextWindow"]
        .as_i64()
        .or_else(|| model["maxContextTokens"].as_i64())
        .or_else(|| model["limit"]["context"].as_i64())
        .filter(|count| *count > 0)
        .or(fallback)
}

pub(super) fn model_catalog(
    session_result: &Value,
    image_input: bool,
    context_window: Option<i64>,
) -> Vec<ModelOption> {
    if let Some(config) = config_option(session_result, "model") {
        let configured: Vec<ModelOption> = config["options"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|model| {
                let id = model["value"].as_str().filter(|value| !value.is_empty())?;
                let display_name = model["name"]
                    .as_str()
                    .or_else(|| model["label"].as_str())
                    .filter(|value| !value.is_empty())
                    .unwrap_or(id);
                Some(ModelOption {
                    id: id.to_owned(),
                    display_name: display_name.to_owned(),
                    context_window: model_context_window(model, context_window),
                    image_input,
                    thinking_efforts: Vec::new(),
                    default_thinking_effort: None,
                })
            })
            .collect();
        if !configured.is_empty() {
            return configured;
        }
    }
    session_result
        .pointer("/models/availableModels")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|model| {
            let id = model["modelId"]
                .as_str()
                .or_else(|| model["id"].as_str())
                .filter(|value| !value.is_empty())?;
            let display_name = model["name"]
                .as_str()
                .or_else(|| model["label"].as_str())
                .filter(|value| !value.is_empty())
                .unwrap_or(id);
            Some(ModelOption {
                id: id.to_owned(),
                display_name: display_name.to_owned(),
                context_window: model_context_window(model, context_window),
                image_input,
                thinking_efforts: Vec::new(),
                default_thinking_effort: None,
            })
        })
        .collect()
}

pub(in crate::agent::providers) async fn readiness(
    spec: &'static AcpSpec,
    cwd: &Path,
    selected_model: Option<&str>,
) -> ProviderReadiness {
    let name = spec.name;
    let Some(binary) = executable(spec) else {
        return ProviderReadiness::new(
            "missing",
            &format!("{name} CLI was not found."),
            &format!("Install {name}, then Retry."),
        );
    };
    let Ok(mut client) = AcpClient::launch(spec, cwd) else {
        return ProviderReadiness::new(
            "unavailable",
            &format!("{name} cannot start."),
            &format!("Update {name} and Retry."),
        );
    };
    let probe = async {
        let (init_result, session_result, mut context_window) = client.open_session(cwd).await?;
        let admitted = admit_session(&init_result, &session_result)?;
        let mut models = model_catalog(&session_result, admitted.image_input, context_window);
        if models.is_empty() {
            return Ok::<_, String>(ProviderReadiness::new(
                "unsupported",
                &format!("{name} models could not be confirmed."),
                &format!("Update {name} and choose a text model, then Retry."),
            ));
        }
        if let Some(model) = selected_model
            && !models.iter().any(|candidate| candidate.id == model)
        {
            let mut readiness = ProviderReadiness::new(
                "unsupported",
                &format!("{name} selected model is not available."),
                &format!("Choose a model from the current {name} catalog, then Retry."),
            );
            readiness.models = models;
            return Ok(readiness);
        }
        let model_cfg = model_config_id(&session_result);
        let mut latest_config = session_result.clone();
        if let Some(model) = selected_model {
            if let Some(config_id) = model_cfg.as_deref() {
                let (updated, updated_window) = client
                    .request(
                        "session/set_config_option",
                        json!({
                            "sessionId": admitted.session_id,
                            "configId": config_id,
                            "value": model
                        }),
                        STARTUP_TIMEOUT,
                    )
                    .await?;
                latest_config = updated;
                if updated_window.is_some() {
                    context_window = updated_window;
                }
            } else {
                let (_, updated_window) = client
                    .request(
                        "session/set_model",
                        json!({ "sessionId": admitted.session_id, "modelId": model }),
                        STARTUP_TIMEOUT,
                    )
                    .await?;
                if updated_window.is_some() {
                    context_window = updated_window;
                }
            }
        }
        let default_model = config_option(&session_result, "model")
            .and_then(|config| config["currentValue"].as_str())
            .or_else(|| {
                session_result
                    .pointer("/models/currentModelId")
                    .and_then(Value::as_str)
            })
            .filter(|value| !value.is_empty() && models.iter().any(|m| m.id == *value))
            .map(str::to_owned);
        let active_model = selected_model
            .map(str::to_owned)
            .or(default_model)
            .or_else(|| models.first().map(|model| model.id.clone()));
        let thinking = thinking_config(&latest_config);
        if let Some(active_id) = active_model.as_deref()
            && let Some(option) = models.iter_mut().find(|model| model.id == active_id)
        {
            if option.context_window.is_none() {
                option.context_window = context_window;
            }
            if let Some(cfg) = &thinking {
                option.thinking_efforts = cfg.options.clone();
                option.default_thinking_effort = cfg.current.clone();
            }
        }
        let mut readiness = ProviderReadiness::new(
            "ready",
            &format!("{name} CLI is initialized; model access is verified on the first answer."),
            "",
        );
        readiness.image_input = admitted.image_input;
        readiness.model = active_model;
        readiness.models = models;
        if let Some(cfg) = thinking {
            readiness.thinking_efforts = cfg.options;
            readiness.thinking_effort = cfg.current;
        }
        Ok(readiness)
    }
    .await;
    client.terminate().await;
    match probe {
        Ok(mut readiness) => {
            if name == "Agy" && readiness.status == "ready" {
                readiness.rate_limits =
                    super::agy_limits::probe_agy_rate_limits(cwd, &binary).await;
            }
            readiness
        }
        Err(reason) if reason.starts_with(&format!("{name} authentication expired.")) => {
            ProviderReadiness::new(
                "authRequired",
                &format!("{name} needs authentication."),
                &format!("Sign in to {name}, then Retry."),
            )
        }
        Err(reason)
            if reason.starts_with(&format!("{name} disconnected."))
                || reason.contains("timed out") =>
        {
            ProviderReadiness::new("unavailable", &reason, &format!("Check {name} and Retry."))
        }
        Err(reason) => ProviderReadiness::new(
            "unsupported",
            &reason,
            &format!(
                "Use Codex or Pi if {name} ACP cannot start; updating {name} may restore compatibility."
            ),
        ),
    }
}
