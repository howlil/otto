use super::rpc::{
    Rpc, available_models, model_accepts_images, model_identity, model_key, thinking_levels,
};
use crate::agent::providers::command_for_binary;
use crate::agent::providers::job::Job;
use crate::agent::{ModelOption, ProviderReadiness, UsageSnapshot};
use serde_json::{Value, json};
use std::{path::PathBuf, process::Stdio, time::Duration};
use tokio::time::timeout;

pub(super) fn valid_pi_model_id(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('-')
        && value.len() <= 256
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.:/@".contains(&byte))
}

pub(in crate::agent::providers) fn executable() -> Option<PathBuf> {
    crate::agent::providers::find_executable(&["pi.exe", "pi.cmd"])
}

pub(super) fn model_option(model: &Value) -> Option<ModelOption> {
    let id = model_key(model)?;
    let name = model["name"]
        .as_str()
        .or_else(|| model["id"].as_str())
        .unwrap_or("Unknown");
    Some(ModelOption {
        id,
        display_name: format!("{} · {name}", model["provider"].as_str()?),
        context_window: model["contextWindow"].as_i64().filter(|count| *count > 0),
        image_input: model["input"]
            .as_array()
            .is_some_and(|inputs| inputs.iter().any(|part| part == "image")),
        thinking_efforts: Vec::new(),
        default_thinking_effort: None,
    })
}

pub(super) fn usage_snapshot(data: &Value) -> Option<UsageSnapshot> {
    let tokens = &data["tokens"];
    let non_negative = |value: &Value| value.as_i64().filter(|count| *count >= 0);
    Some(UsageSnapshot {
        context_tokens: non_negative(&data["contextUsage"]["tokens"]),
        session_tokens: non_negative(&tokens["total"])?,
        input_tokens: non_negative(&tokens["input"])?,
        cached_input_tokens: non_negative(&tokens["cacheRead"]).unwrap_or(0),
        output_tokens: non_negative(&tokens["output"])?,
        reasoning_output_tokens: None,
        model_context_window: data["contextUsage"]["contextWindow"]
            .as_i64()
            .filter(|count| *count > 0),
    })
}

pub(super) fn authentication(state: &Value) -> ProviderReadiness {
    match state["status"].as_str() {
        Some("ready") => ProviderReadiness::new("ready", "Pi is ready for text.", ""),
        Some("not_ready") => ProviderReadiness::new(
            "authRequired",
            "Pi needs provider sign-in.",
            "Authenticate the active Pi model, then Retry.",
        ),
        Some("invalid") => ProviderReadiness::new(
            "unavailable",
            "Pi could not verify the selected model or provider credentials.",
            "Check the selected Pi model and provider sign-in, then Retry.",
        ),
        _ => ProviderReadiness::new(
            "unsupported",
            "Pi credential state is not supported.",
            "Update Pi and select a supported model.",
        ),
    }
}

pub(super) const READINESS_RPC_TIMEOUT: Duration = Duration::from_secs(75);
pub(super) const AUTH_PROBE_TIMEOUT: Duration = Duration::from_secs(25);

pub(super) enum ReadinessOutcome {
    ModelUnavailable(Vec<ModelOption>),
    Ready {
        model: String,
        models: Vec<ModelOption>,
        efforts: Vec<String>,
        thinking: Option<String>,
        image_input: bool,
    },
    Failed {
        models: Vec<ModelOption>,
        timed_out: bool,
    },
}

pub(super) fn failure_readiness(models: Vec<ModelOption>, timed_out: bool) -> ProviderReadiness {
    let mut readiness = if timed_out {
        ProviderReadiness::new(
            "unavailable",
            "Pi readiness check timed out.",
            "Wait for Pi extensions to finish loading, then Retry.",
        )
    } else {
        ProviderReadiness::new(
            "unsupported",
            "Pi model catalog or selected model could not be confirmed.",
            "Check the current Pi model configuration and Retry.",
        )
    };
    readiness.models = models;
    readiness
}

async fn probe_rpc(rpc: &mut Rpc, selected_model: Option<&str>) -> ReadinessOutcome {
    let catalog = match rpc
        .request(json!({"type":"get_available_models"}))
        .await
        .and_then(|data| available_models(&data))
    {
        Ok(catalog) => catalog,
        Err(reason) => {
            return ReadinessOutcome::Failed {
                models: Vec::new(),
                timed_out: reason.contains("timed out"),
            };
        }
    };
    let mut models = catalog.iter().filter_map(model_option).collect::<Vec<_>>();
    let state = match rpc.state().await {
        Ok(state) => state,
        Err(reason) => {
            return ReadinessOutcome::Failed {
                models,
                timed_out: reason.contains("timed out"),
            };
        }
    };
    let Some(selected) = selected_model
        .map(str::to_owned)
        .or_else(|| model_identity(&state))
        .or_else(|| catalog.first().and_then(model_key))
    else {
        return ReadinessOutcome::Failed {
            models,
            timed_out: false,
        };
    };
    let Some(chosen) = catalog
        .iter()
        .find(|model| model_key(model).as_deref() == Some(selected.as_str()))
    else {
        return ReadinessOutcome::ModelUnavailable(models);
    };
    if model_identity(&state).as_deref() != Some(selected.as_str())
        && let Err(reason) = rpc
            .request(json!({
                "type":"set_model",
                "provider":chosen["provider"],
                "modelId":chosen["id"]
            }))
            .await
    {
        return ReadinessOutcome::Failed {
            models,
            timed_out: reason.contains("timed out"),
        };
    }
    let confirmed = match rpc.state().await {
        Ok(confirmed) => confirmed,
        Err(reason) => {
            return ReadinessOutcome::Failed {
                models,
                timed_out: reason.contains("timed out"),
            };
        }
    };
    if model_identity(&confirmed).as_deref() != Some(selected.as_str()) {
        return ReadinessOutcome::Failed {
            models,
            timed_out: false,
        };
    }
    let raw_efforts = match rpc
        .request(json!({"type":"get_available_thinking_levels"}))
        .await
        .and_then(|data| thinking_levels(&data))
    {
        Ok(levels) => levels,
        Err(reason) => {
            return ReadinessOutcome::Failed {
                models,
                timed_out: reason.contains("timed out"),
            };
        }
    };
    let (efforts, thinking) =
        if raw_efforts.is_empty() || (raw_efforts.len() == 1 && raw_efforts[0] == "off") {
            (Vec::new(), None)
        } else {
            let level = confirmed["thinkingLevel"]
                .as_str()
                .filter(|value| raw_efforts.iter().any(|candidate| candidate == value))
                .map(str::to_owned);
            (raw_efforts, level)
        };
    if let Some(model) = models.iter_mut().find(|model| model.id == selected) {
        model.thinking_efforts = efforts.clone();
        model.default_thinking_effort = thinking.clone();
    }
    ReadinessOutcome::Ready {
        model: selected,
        models,
        efforts,
        thinking,
        image_input: model_accepts_images(&confirmed),
    }
}

pub(in crate::agent::providers) async fn readiness(
    cwd: &PathBuf,
    selected_model: Option<&str>,
) -> ProviderReadiness {
    let Some(binary) = executable() else {
        return ProviderReadiness::new(
            "missing",
            "Pi CLI was not found.",
            "Install Pi, then Retry.",
        );
    };
    let Ok(mut rpc) = Rpc::launch(cwd) else {
        return ProviderReadiness::new(
            "unavailable",
            "Cannot start Pi RPC.",
            "Update Pi and Retry.",
        );
    };
    let probe = timeout(READINESS_RPC_TIMEOUT, probe_rpc(&mut rpc, selected_model)).await;
    rpc.terminate().await;
    let (model, models, efforts, thinking, image_input) = match probe {
        Ok(ReadinessOutcome::Ready {
            model,
            models,
            efforts,
            thinking,
            image_input,
        }) => (model, models, efforts, thinking, image_input),
        Ok(ReadinessOutcome::ModelUnavailable(models)) => {
            let mut readiness = ProviderReadiness::new(
                "unsupported",
                "Pi selected model is not available in the current Pi configuration.",
                "Choose an available model below, then Retry.",
            );
            readiness.models = models;
            return readiness;
        }
        Ok(ReadinessOutcome::Failed { models, timed_out }) => {
            return failure_readiness(models, timed_out);
        }
        Err(_) => {
            return failure_readiness(Vec::new(), true);
        }
    };
    if !valid_pi_model_id(&model) {
        let mut readiness = authentication(&json!({ "status": "invalid" }));
        readiness.models = models;
        return readiness;
    }
    let mut command = command_for_binary(binary);
    command
        .args(["auth", "check", "--model", &model, "--json"])
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut readiness = match Job::probe(command, AUTH_PROBE_TIMEOUT).await {
        Ok(output) => match serde_json::from_slice::<Value>(&output.stdout) {
            Ok(value) => authentication(&value),
            Err(_) => ProviderReadiness::new(
                "unsupported",
                "Pi auth probe is incompatible.",
                "Update Pi and Retry.",
            ),
        },
        _ => ProviderReadiness::new(
            "unavailable",
            "Pi authentication check timed out.",
            "Retry after checking Pi.",
        ),
    };
    readiness.image_input = readiness.status == "ready" && image_input;
    readiness.model = Some(model);
    readiness.models = models;
    readiness.thinking_effort = thinking;
    readiness.thinking_efforts = efforts;
    readiness
}
