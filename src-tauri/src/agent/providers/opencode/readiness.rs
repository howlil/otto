use crate::agent::providers::{read_bounded_line, transport::JsonlProcess};
use crate::agent::{ModelOption, ProviderReadiness};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::time::timeout;

pub(super) const MAX_OUTPUT: usize = 2 * 1024 * 1024;

pub fn executable() -> Option<PathBuf> {
    crate::agent::providers::find_executable(&["opencode.exe", "opencode.cmd"])
}

async fn output(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let binary =
        executable().ok_or("OpenCode is not installed. Install opencode-ai, then Retry.")?;
    let (mut process, _) = JsonlProcess::launch(
        "OpenCode",
        &binary,
        args,
        cwd,
        false,
        "OpenCode could not start.",
    )?;
    process.close_input();
    let result = timeout(Duration::from_secs(30), async {
        let mut output = String::new();
        while let Some(line) = read_bounded_line(process.reader(), MAX_OUTPUT)
            .await
            .map_err(|_| "OpenCode returned an invalid response.")?
        {
            if output.len().saturating_add(line.len() + 1) > MAX_OUTPUT {
                return Err("OpenCode response exceeded its limit.".into());
            }
            output.push_str(&line);
            output.push('\n');
        }
        process.wait_success().await?;
        Ok(output)
    })
    .await
    .map_err(|_| "OpenCode readiness timed out.".to_string())
    .and_then(|result| result);
    process.kill_now().await;
    result
}

pub(super) fn model_id(value: &str) -> bool {
    value.len() <= 256
        && value
            .split_once('/')
            .is_some_and(|(provider, model)| !provider.is_empty() && !model.is_empty())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.:/".contains(&byte))
}

pub(super) fn valid_variant(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
}

fn apply_verbose_metadata(option: &mut ModelOption, meta: &serde_json::Value) {
    if let Some(name) = meta["name"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        option.display_name = name.to_owned();
    }
    if let Some(context) = meta["limit"]["context"]
        .as_i64()
        .or_else(|| meta["contextWindow"].as_i64())
        .filter(|count| *count > 0)
    {
        option.context_window = Some(context);
    }
    let input_has_image = meta["modalities"]["input"].as_array().is_some_and(|items| {
        items.iter().any(|item| {
            item.as_str()
                .is_some_and(|kind| kind.eq_ignore_ascii_case("image"))
        })
    });
    if input_has_image || meta["attachment"].as_bool() == Some(true) {
        option.image_input = true;
    }
    if let Some(variants) = meta["variants"].as_object() {
        let mut efforts = Vec::new();
        for key in variants.keys() {
            if valid_variant(key) && !efforts.iter().any(|existing| existing == key) {
                efforts.push(key.clone());
            }
        }
        if !efforts.is_empty() {
            let order = [
                "none", "off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra",
            ];
            efforts.sort_by_key(|item| {
                order
                    .iter()
                    .position(|known| known.eq_ignore_ascii_case(item))
                    .unwrap_or(order.len())
            });
            option.thinking_efforts = efforts;
        }
    }
}

fn models(output: &str) -> Vec<ModelOption> {
    let mut options: Vec<ModelOption> = Vec::new();
    let mut lines = output.lines().peekable();
    while let Some(raw_line) = lines.next() {
        let id = raw_line.trim();
        if !model_id(id) || options.len() >= 2048 {
            continue;
        }
        let mut option = ModelOption {
            id: id.into(),
            display_name: id.into(),
            context_window: None,
            image_input: false,
            thinking_efforts: Vec::new(),
            default_thinking_effort: None,
        };
        if lines
            .peek()
            .is_some_and(|next| next.trim_start().starts_with('{'))
        {
            let mut block = String::new();
            let mut depth = 0i32;
            let mut in_string = false;
            let mut escaped = false;
            for line in lines.by_ref() {
                block.push_str(line);
                block.push('\n');
                for ch in line.chars() {
                    if escaped {
                        escaped = false;
                        continue;
                    }
                    if in_string {
                        if ch == '\\' {
                            escaped = true;
                        } else if ch == '"' {
                            in_string = false;
                        }
                        continue;
                    }
                    match ch {
                        '"' => in_string = true,
                        '{' => depth += 1,
                        '}' => depth -= 1,
                        _ => {}
                    }
                }
                if depth <= 0 || block.len() > 65_536 {
                    break;
                }
            }
            if let Ok(meta) = serde_json::from_str::<serde_json::Value>(&block) {
                apply_verbose_metadata(&mut option, &meta);
            }
        }
        if options.iter().any(|existing| existing.id == id) {
            continue;
        }
        options.push(option);
    }
    options
}

pub(super) async fn probe(
    cwd: &Path,
    model: Option<&str>,
) -> Result<(Vec<ModelOption>, Option<String>), (String, Vec<ModelOption>)> {
    let raw = match output(cwd, &["models", "--verbose"]).await {
        Ok(text) => text,
        Err(_) => output(cwd, &["models"])
            .await
            .map_err(|reason| (reason, Vec::new()))?,
    };
    let options = models(&raw);
    let selected = match model {
        Some(id) if options.iter().any(|option| option.id == id) => Some(id.to_owned()),
        Some(_) => {
            return Err((
                "The selected OpenCode model is unavailable. Choose an available model.".into(),
                options,
            ));
        }
        None => None,
    };
    if options.is_empty() {
        return Err((
            "OpenCode did not report any available models. Run opencode auth login, then Retry."
                .into(),
            options,
        ));
    }
    Ok((options, selected))
}

pub async fn readiness(cwd: &Path, model: Option<&str>) -> ProviderReadiness {
    if executable().is_none() {
        return ProviderReadiness::new(
            "missing",
            "OpenCode is not installed.",
            "Install opencode-ai and sign in with opencode auth login, then Retry.",
        );
    }
    match probe(cwd, model).await {
        Ok((models, selected)) => {
            let supports_images = selected
                .as_deref()
                .and_then(|id| models.iter().find(|item| item.id == id))
                .map(|item| item.image_input)
                .unwrap_or_else(|| models.iter().any(|item| item.image_input));
            let message = if supports_images {
                "OpenCode is ready."
            } else {
                "OpenCode is ready for text."
            };
            let mut ready = ProviderReadiness::new("ready", message, "");
            ready.image_input = supports_images;
            ready.models = models;
            ready.model = selected;
            ready
        }
        Err((reason, models)) => {
            let mut readiness = ProviderReadiness::new(
                "unsupported",
                &reason,
                "Check OpenCode installation and authentication, then Retry.",
            );
            readiness.models = models;
            readiness
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_preserves_nested_ids_and_rejects_shell_metacharacters() {
        let options = models(
            "provider/family/model\nprovider/family/model\nprovider/other\nprovider/evil&whoami\n/provider\nstartup message\n",
        );
        assert_eq!(
            options
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            ["provider/family/model", "provider/other"]
        );
        assert!(
            options
                .iter()
                .all(|model| !model.image_input && model.thinking_efforts.is_empty())
        );
    }

    #[test]
    fn verbose_catalog_extracts_context_window_and_dynamic_variants() {
        let raw = concat!(
            "openai/gpt-5.6\n",
            "{\"id\":\"gpt-5.6\",\"name\":\"GPT-5.6\",\"limit\":{\"context\":272000,\"output\":16384},\"variants\":{\"low\":{},\"medium\":{},\"high\":{}}}\n",
            "openai/gpt-4o-mini\n",
            "{\"id\":\"gpt-4o-mini\",\"name\":\"GPT-4o Mini\",\"limit\":{\"context\":128000}}\n"
        );
        let options = models(raw);
        assert_eq!(options.len(), 2);
        assert_eq!(options[0].id, "openai/gpt-5.6");
        assert_eq!(options[0].display_name, "GPT-5.6");
        assert_eq!(options[0].context_window, Some(272_000));
        assert_eq!(options[0].thinking_efforts, ["low", "medium", "high"]);
        assert_eq!(options[1].id, "openai/gpt-4o-mini");
        assert_eq!(options[1].context_window, Some(128_000));
        assert!(options[1].thinking_efforts.is_empty());
        assert!(!options[1].image_input);
    }

    #[test]
    fn verbose_catalog_detects_vision_modalities_and_attachments() {
        let raw = concat!(
            "openai/gpt-5-vision\n",
            "{\"id\":\"gpt-5-vision\",\"name\":\"GPT-5 Vision\",\"modalities\":{\"input\":[\"text\",\"image\"],\"output\":[\"text\"]}}\n",
            "anthropic/claude-attach\n",
            "{\"id\":\"claude-attach\",\"name\":\"Claude Attach\",\"attachment\":true}\n",
            "openai/text-only\n",
            "{\"id\":\"text-only\",\"name\":\"Text Only\",\"modalities\":{\"input\":[\"text\"]},\"attachment\":false}\n"
        );
        let options = models(raw);
        assert_eq!(options.len(), 3);
        assert!(options[0].image_input);
        assert!(options[1].image_input);
        assert!(!options[2].image_input);
    }
}
