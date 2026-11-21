use crate::agent::ProviderId;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

const PREFS_VERSION: u32 = 1;
const MAX_MODEL_ENTRIES: usize = 64;
const MAX_EFFORT_ENTRIES: usize = 256;
const MAX_PINS_PER_PROVIDER: usize = 24;
const MAX_ID_LEN: usize = 256;
const MAX_EFFORT_LEN: usize = 32;

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePrefs {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub provider: ProviderId,
    #[serde(default)]
    pub models: HashMap<String, String>,
    #[serde(default)]
    pub thinking_efforts: HashMap<String, String>,
    #[serde(default)]
    pub pinned_models: HashMap<String, Vec<String>>,
}

pub(crate) struct RuntimePrefsStore {
    path: Option<PathBuf>,
    state: Mutex<RuntimePrefs>,
}

impl RuntimePrefsStore {
    pub(crate) fn memory() -> Self {
        Self {
            path: None,
            state: Mutex::new(RuntimePrefs {
                version: PREFS_VERSION,
                ..RuntimePrefs::default()
            }),
        }
    }

    pub(crate) fn file(path: PathBuf) -> Self {
        let initial = load_from_disk(&path);
        Self {
            path: Some(path),
            state: Mutex::new(initial),
        }
    }

    pub(crate) fn snapshot(&self) -> RuntimePrefs {
        self.state
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_else(|poisoned| poisoned.into_inner().clone())
    }

    pub(crate) fn active_provider(&self) -> ProviderId {
        self.state
            .lock()
            .map(|guard| guard.provider)
            .unwrap_or_else(|poisoned| poisoned.into_inner().provider)
    }

    pub(crate) fn preferred_selection(
        &self,
        provider: ProviderId,
    ) -> (Option<String>, Option<String>) {
        let guard = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let provider_key = provider.as_str();
        let model = guard.models.get(provider_key).cloned();
        let effort = model
            .as_deref()
            .and_then(|model_id| {
                guard
                    .thinking_efforts
                    .get(&effort_key(provider_key, model_id))
            })
            .or_else(|| guard.thinking_efforts.get(provider_key))
            .cloned();
        (model, effort)
    }

    pub(crate) fn set_provider(&self, provider: ProviderId) -> (Option<String>, Option<String>) {
        let (selection, snapshot) = {
            let mut guard = self
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            guard.version = PREFS_VERSION;
            guard.provider = provider;
            let provider_key = provider.as_str();
            let model = guard.models.get(provider_key).cloned();
            let effort = model
                .as_deref()
                .and_then(|model_id| {
                    guard
                        .thinking_efforts
                        .get(&effort_key(provider_key, model_id))
                })
                .or_else(|| guard.thinking_efforts.get(provider_key))
                .cloned();
            ((model, effort), guard.clone())
        };
        self.persist(&snapshot);
        selection
    }

    pub(crate) fn set_selection(
        &self,
        provider: ProviderId,
        model: Option<&str>,
        thinking_effort: Option<&str>,
    ) {
        let snapshot = {
            let mut guard = self
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            guard.version = PREFS_VERSION;
            let provider_key = provider.as_str().to_owned();
            let clean_model = model
                .map(str::trim)
                .filter(|value| !value.is_empty() && value.len() <= MAX_ID_LEN);
            if let Some(model_id) = clean_model {
                if guard.models.len() < MAX_MODEL_ENTRIES
                    || guard.models.contains_key(&provider_key)
                {
                    guard
                        .models
                        .insert(provider_key.clone(), model_id.to_owned());
                }
            } else {
                guard.models.remove(&provider_key);
            }
            let key = clean_model
                .map(|model_id| effort_key(&provider_key, model_id))
                .unwrap_or(provider_key);
            let clean_effort = thinking_effort
                .map(str::trim)
                .filter(|value| !value.is_empty() && value.len() <= MAX_EFFORT_LEN);
            if let Some(effort) = clean_effort {
                if guard.thinking_efforts.len() < MAX_EFFORT_ENTRIES
                    || guard.thinking_efforts.contains_key(&key)
                {
                    guard.thinking_efforts.insert(key, effort.to_owned());
                }
            } else {
                guard.thinking_efforts.remove(&key);
            }
            guard.clone()
        };
        self.persist(&snapshot);
    }

    pub(crate) fn toggle_pinned_model(&self, provider: ProviderId, model_id: &str) -> Vec<String> {
        let clean = model_id.trim();
        if clean.is_empty() || clean.len() > MAX_ID_LEN {
            return self.pinned_models(provider);
        }
        let (pins, snapshot) = {
            let mut guard = self
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            guard.version = PREFS_VERSION;
            let entry = guard
                .pinned_models
                .entry(provider.as_str().to_owned())
                .or_default();
            if let Some(index) = entry.iter().position(|existing| existing == clean) {
                entry.remove(index);
            } else {
                if entry.len() >= MAX_PINS_PER_PROVIDER {
                    entry.pop();
                }
                entry.insert(0, clean.to_owned());
            }
            let pins = entry.clone();
            if entry.is_empty() {
                guard.pinned_models.remove(provider.as_str());
            }
            (pins, guard.clone())
        };
        self.persist(&snapshot);
        pins
    }

    pub(crate) fn pinned_models(&self, provider: ProviderId) -> Vec<String> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .pinned_models
            .get(provider.as_str())
            .cloned()
            .unwrap_or_default()
    }

    fn persist(&self, prefs: &RuntimePrefs) {
        let Some(path) = self.path.as_ref() else {
            return;
        };
        let _ = write_json_atomic(path, prefs);
    }
}

fn effort_key(provider: &str, model: &str) -> String {
    format!("{provider}:{model}")
}

fn load_from_disk(path: &Path) -> RuntimePrefs {
    let Ok(bytes) = fs::read(path) else {
        return RuntimePrefs {
            version: PREFS_VERSION,
            ..RuntimePrefs::default()
        };
    };
    let Ok(mut prefs) = serde_json::from_slice::<RuntimePrefs>(&bytes) else {
        return RuntimePrefs {
            version: PREFS_VERSION,
            ..RuntimePrefs::default()
        };
    };
    prefs.version = PREFS_VERSION;
    prefs
        .models
        .retain(|key, val| !key.is_empty() && !val.trim().is_empty() && val.len() <= MAX_ID_LEN);
    prefs.thinking_efforts.retain(|key, val| {
        !key.is_empty() && !val.trim().is_empty() && val.len() <= MAX_EFFORT_LEN
    });
    for pins in prefs.pinned_models.values_mut() {
        pins.retain(|item| !item.trim().is_empty() && item.len() <= MAX_ID_LEN);
        pins.truncate(MAX_PINS_PER_PROVIDER);
    }
    prefs.pinned_models.retain(|_, pins| !pins.is_empty());
    prefs
}

pub(super) fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), ()> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or(())?;
    fs::create_dir_all(parent).map_err(|_| ())?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let temporary = path.with_extension(format!("json.tmp-{}-{nonce}", std::process::id()));
    let bytes = serde_json::to_vec(value).map_err(|_| ())?;
    let result = (|| {
        let mut file = fs::File::create(&temporary).map_err(|_| ())?;
        file.write_all(&bytes).map_err(|_| ())?;
        commit_atomic(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(windows)]
fn commit_atomic(temporary: &Path, path: &Path) -> Result<(), ()> {
    use windows_sys::Win32::Storage::FileSystem::{MOVEFILE_REPLACE_EXISTING, MoveFileExW};
    let temp_wide: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
    let dest_wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let ok = unsafe {
        MoveFileExW(
            temp_wide.as_ptr(),
            dest_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING,
        )
    };
    if ok == 0 { Err(()) } else { Ok(()) }
}

#[cfg(not(windows))]
fn commit_atomic(temporary: &Path, path: &Path) -> Result<(), ()> {
    fs::rename(temporary, path).map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_prefs_path(label: &str) -> PathBuf {
        std::env::temp_dir()
            .join(format!(
                "otto-prefs-{label}-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ))
            .join("agent-prefs.json")
    }

    #[test]
    fn runtime_prefs_persist_active_provider_per_engine_models_per_model_efforts_and_pins() {
        let path = temp_prefs_path("round-trip");
        let store = RuntimePrefsStore::file(path.clone());
        assert_eq!(store.active_provider(), ProviderId::Codex);
        store.set_selection(ProviderId::Codex, Some("gpt-5-codex"), Some("medium"));
        store.set_provider(ProviderId::Claude);
        store.set_selection(ProviderId::Claude, Some("claude-sonnet-5-5"), Some("high"));
        store.set_selection(ProviderId::Claude, Some("claude-haiku-4-5"), None);
        let pins = store.toggle_pinned_model(ProviderId::Claude, "claude-sonnet-5-5");
        assert_eq!(pins, vec!["claude-sonnet-5-5"]);

        let reloaded = RuntimePrefsStore::file(path.clone());
        assert_eq!(reloaded.active_provider(), ProviderId::Claude);
        assert_eq!(
            reloaded.preferred_selection(ProviderId::Codex),
            (Some("gpt-5-codex".into()), Some("medium".into()))
        );
        assert_eq!(
            reloaded.preferred_selection(ProviderId::Claude),
            (Some("claude-haiku-4-5".into()), None)
        );
        reloaded.set_selection(ProviderId::Claude, Some("claude-sonnet-5-5"), Some("high"));
        assert_eq!(
            reloaded.preferred_selection(ProviderId::Claude),
            (Some("claude-sonnet-5-5".into()), Some("high".into()))
        );
        assert_eq!(
            reloaded.pinned_models(ProviderId::Claude),
            vec!["claude-sonnet-5-5"]
        );
        let unpinned = reloaded.toggle_pinned_model(ProviderId::Claude, "claude-sonnet-5-5");
        assert!(unpinned.is_empty());

        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn corrupt_prefs_file_falls_back_cleanly_to_defaults() {
        let path = temp_prefs_path("corrupt");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"{not valid json").unwrap();
        let store = RuntimePrefsStore::file(path.clone());
        assert_eq!(store.active_provider(), ProviderId::Codex);
        assert_eq!(store.preferred_selection(ProviderId::Codex), (None, None));
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }
}
