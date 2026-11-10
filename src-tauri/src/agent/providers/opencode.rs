mod turn;

use super::{read_bounded_line, transport::JsonlProcess};
use crate::agent::{ModelOption, ProviderReadiness};
use serde_json::{Value, json};
use std::{
    ffi::OsString,
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::time::timeout;

pub use turn::run;

const MAX_OUTPUT: usize = 2 * 1024 * 1024;
const AGENT: &str = "otto-chat";

pub fn executable() -> Option<PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH")?)
        .flat_map(|directory| ["opencode.exe", "opencode.cmd"].map(|name| directory.join(name)))
        .find(|path| path.is_file())
}

struct Profile {
    root: PathBuf,
    env: Vec<(OsString, OsString)>,
}

impl Profile {
    fn new(model: Option<&str>) -> Result<Self, String> {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "System clock is unavailable.")?
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("otto-opencode-{}-{stamp}", std::process::id()));
        std::fs::create_dir(&root)
            .map_err(|_| "OpenCode isolation folder could not be created.")?;
        let mut profile = Self {
            root,
            env: Vec::new(),
        };
        let config = profile.root.join("config/opencode");
        std::fs::create_dir_all(&config)
            .map_err(|_| "OpenCode isolated configuration could not be created.")?;
        let data = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| crate::agent::default_workspace_path().join(".local/share"));
        let mut agent = json!({"description":"Tool-free Otto chat", "mode":"primary", "permission":{"*":"deny"}, "tools":{"*":false}, "prompt":"Answer the user's question with text only. Do not invoke tools."});
        if let Some(model) = model {
            agent["model"] = json!(model);
        }
        let settings = json!({"autoupdate":false,"permission":{"*":"deny"},"agent":{AGENT:agent}});
        profile.env = vec![
            ("PWD".into(), profile.root.as_os_str().into()),
            ("HOME".into(), profile.root.as_os_str().into()),
            ("USERPROFILE".into(), profile.root.as_os_str().into()),
            (
                "XDG_CONFIG_HOME".into(),
                profile.root.join("config").into_os_string(),
            ),
            (
                "XDG_CACHE_HOME".into(),
                profile.root.join("cache").into_os_string(),
            ),
            (
                "XDG_STATE_HOME".into(),
                profile.root.join("state").into_os_string(),
            ),
            ("XDG_DATA_HOME".into(), data.into_os_string()),
            (
                "OPENCODE_CONFIG".into(),
                profile.root.join("absent.json").into_os_string(),
            ),
            ("OPENCODE_CONFIG_DIR".into(), config.into_os_string()),
            (
                "OPENCODE_CONFIG_CONTENT".into(),
                settings.to_string().into(),
            ),
            ("OPENCODE_DISABLE_PROJECT_CONFIG".into(), "true".into()),
            ("OPENCODE_DISABLE_CLAUDE_CODE".into(), "true".into()),
            ("OPENCODE_DISABLE_EXTERNAL_SKILLS".into(), "true".into()),
            ("OPENCODE_DISABLE_AUTOUPDATE".into(), "true".into()),
        ];
        Ok(profile)
    }

    fn launch(&self, args: &[&str]) -> Result<JsonlProcess, String> {
        let binary =
            executable().ok_or("OpenCode is not installed. Install opencode-ai, then Retry.")?;
        JsonlProcess::launch_env(
            "OpenCode",
            &binary,
            args,
            &self.root,
            false,
            "OpenCode could not start.",
            &self.env,
        )
        .map(|(process, _)| process)
    }

    async fn output(&self, args: &[&str]) -> Result<String, String> {
        let mut process = self.launch(args)?;
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
}

impl Drop for Profile {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn model_id(value: &str) -> bool {
    value.len() <= 256
        && value
            .split_once('/')
            .is_some_and(|(provider, model)| !provider.is_empty() && !model.is_empty())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.:/".contains(&byte))
}

fn models(output: &str) -> Vec<ModelOption> {
    let mut options = Vec::new();
    for id in output
        .lines()
        .map(str::trim)
        .filter(|id| model_id(id))
        .take(2048)
    {
        if options.iter().any(|option: &ModelOption| option.id == id) {
            continue;
        }
        options.push(ModelOption {
            id: id.into(),
            display_name: id.into(),
            context_window: None,
            image_input: false,
            thinking_efforts: Vec::new(),
            default_thinking_effort: None,
        });
    }
    options
}

fn admitted(value: &Value) -> bool {
    value["name"] == AGENT
        && value["tools"].as_object().is_some_and(|tools| {
            !tools.is_empty() && tools.values().all(|enabled| enabled == false)
        })
        && value["permission"].as_array().is_some_and(|rules| {
            rules.iter().any(|rule| {
                rule["permission"] == "*" && rule["pattern"] == "*" && rule["action"] == "deny"
            })
        })
}

async fn probe(model: Option<&str>) -> Result<(Profile, Vec<ModelOption>, String), String> {
    let profile = Profile::new(None)?;
    let options = models(&profile.output(&["models"]).await?);
    let selected = match model {
        Some(id) if options.iter().any(|option| option.id == id) => id.to_owned(),
        Some(_) => {
            return Err(
                "The selected OpenCode model is unavailable. Choose an available model.".into(),
            );
        }
        None => options
            .first()
            .ok_or("OpenCode has no available models. Run opencode auth login, then Retry.")?
            .id
            .clone(),
    };
    drop(profile);
    let profile = Profile::new(Some(&selected))?;
    let output = profile.output(&["debug", "agent", AGENT]).await?;
    let config: Value = serde_json::from_str(&output)
        .map_err(|_| "OpenCode did not report a verifiable agent configuration.")?;
    if !admitted(&config) {
        return Err("OpenCode could not confirm that every chat tool is disabled. Update OpenCode, then Retry.".into());
    }
    Ok((profile, options, selected))
}

pub async fn readiness(_cwd: &PathBuf, model: Option<&str>) -> ProviderReadiness {
    if executable().is_none() {
        return ProviderReadiness::new(
            "missing",
            "OpenCode is not installed.",
            "Install opencode-ai and sign in with opencode auth login, then Retry.",
        );
    }
    match probe(model).await {
        Ok((_, models, selected)) => {
            let mut ready = ProviderReadiness::new("ready", "OpenCode is ready for text.", "");
            ready.models = models;
            ready.model = Some(selected);
            ready.tool_free_admission = true;
            ready
        }
        Err(reason) => ProviderReadiness::new(
            "unsupported",
            &reason,
            "Check OpenCode installation and authentication, then Retry.",
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_overrides_inherited_working_directory_and_removes_its_owned_folder() {
        let profile = Profile::new(None).unwrap();
        let root = profile.root.clone();
        for name in ["PWD", "HOME", "USERPROFILE"] {
            assert_eq!(
                profile.env.iter().find(|(key, _)| key == name).unwrap().1,
                root.as_os_str()
            );
        }
        drop(profile);
        assert!(!root.exists());
    }

    #[test]
    fn admission_requires_identity_resolved_disabled_tools_and_deny_policy() {
        let safe = json!({"name":AGENT,"tools":{"read":false,"bash":false},"permission":[{"permission":"*","pattern":"*","action":"deny"}]});
        assert!(admitted(&safe));
        for unsafe_value in [json!({}), json!({"name":AGENT,"tools":{}})] {
            assert!(!admitted(&unsafe_value));
        }
        let mut value = safe.clone();
        value["tools"]["read"] = json!(true);
        assert!(!admitted(&value));
        let mut value = safe.clone();
        value["name"] = json!("build");
        assert!(!admitted(&value));
        let mut value = safe;
        value["permission"] = json!([]);
        assert!(!admitted(&value));
    }

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
}
