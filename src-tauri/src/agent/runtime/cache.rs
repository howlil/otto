use super::prefs::write_json_atomic;
use crate::agent::{ProviderId, ProviderRateLimit, ProviderReadiness};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

const CACHE_VERSION: u32 = 1;
pub(crate) const READINESS_FRESH_TTL_SECS: u64 = 1_800;
pub(crate) const READINESS_STALE_MAX_SECS: u64 = 7 * 86_400;
pub(crate) const RATE_LIMIT_TTL_SECS: u64 = 300;
const MAX_MODEL_DETAILS_PER_PROVIDER: usize = 64;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedModelDetails {
    context_window: Option<i64>,
    image_input: bool,
    thinking_efforts: Vec<String>,
    default_thinking_effort: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedProviderEntry {
    readiness: ProviderReadiness,
    fetched_at: u64,
    binary_fingerprint: Option<String>,
    #[serde(default)]
    model_details: HashMap<String, CachedModelDetails>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedRateLimits {
    limits: Vec<ProviderRateLimit>,
    fetched_at: u64,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheFile {
    version: u32,
    #[serde(default)]
    providers: HashMap<String, CachedProviderEntry>,
    #[serde(default)]
    rate_limits: HashMap<String, CachedRateLimits>,
}

pub(crate) enum CacheHit {
    Fresh(ProviderReadiness),
    Stale(ProviderReadiness),
    Miss,
}

pub(crate) struct ReadinessCacheStore {
    path: Option<PathBuf>,
    state: Mutex<CacheFile>,
}

impl ReadinessCacheStore {
    pub(crate) fn memory() -> Self {
        Self {
            path: None,
            state: Mutex::new(CacheFile {
                version: CACHE_VERSION,
                ..CacheFile::default()
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

    pub(crate) fn lookup(
        &self,
        provider: ProviderId,
        fingerprint: Option<&str>,
        requested_model: Option<&str>,
    ) -> CacheHit {
        self.lookup_at(provider, fingerprint, requested_model, now_secs())
    }

    pub(crate) fn lookup_at(
        &self,
        provider: ProviderId,
        fingerprint: Option<&str>,
        requested_model: Option<&str>,
        now: u64,
    ) -> CacheHit {
        let guard = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let key = provider.as_str();
        let Some(entry) = guard.providers.get(key) else {
            return CacheHit::Miss;
        };
        if entry.readiness.status != "ready" {
            return CacheHit::Miss;
        }
        if entry.binary_fingerprint.as_deref() != fingerprint {
            return CacheHit::Miss;
        }
        let age = now.saturating_sub(entry.fetched_at);
        if age > READINESS_STALE_MAX_SECS {
            return CacheHit::Miss;
        }
        let Some((mut projected, needs_model_refresh)) =
            project_model(provider, entry, requested_model)
        else {
            return CacheHit::Miss;
        };
        if let Some(cached_limits) = guard.rate_limits.get(key)
            && !cached_limits.limits.is_empty()
            && now.saturating_sub(cached_limits.fetched_at) <= READINESS_STALE_MAX_SECS
        {
            projected.rate_limits = cached_limits.limits.clone();
        }
        let stale = age > READINESS_FRESH_TTL_SECS || needs_model_refresh;
        projected.stale = stale;
        if stale {
            CacheHit::Stale(projected)
        } else {
            CacheHit::Fresh(projected)
        }
    }

    pub(crate) fn store(
        &self,
        provider: ProviderId,
        fingerprint: Option<String>,
        readiness: &ProviderReadiness,
        requested_model: Option<&str>,
    ) {
        self.store_at(
            provider,
            fingerprint,
            readiness,
            requested_model,
            now_secs(),
        );
    }

    pub(crate) fn store_at(
        &self,
        provider: ProviderId,
        fingerprint: Option<String>,
        readiness: &ProviderReadiness,
        requested_model: Option<&str>,
        now: u64,
    ) {
        if readiness.status != "ready" {
            return;
        }
        let snapshot = {
            let mut guard = self
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            guard.version = CACHE_VERSION;
            let key = provider.as_str().to_owned();
            let mut details = guard
                .providers
                .get(&key)
                .filter(|existing| existing.binary_fingerprint == fingerprint)
                .map(|existing| existing.model_details.clone())
                .unwrap_or_default();
            for option in &readiness.models {
                if !option.thinking_efforts.is_empty()
                    && details.len() < MAX_MODEL_DETAILS_PER_PROVIDER
                {
                    details.insert(
                        option.id.clone(),
                        CachedModelDetails {
                            context_window: option.context_window,
                            image_input: option.image_input,
                            thinking_efforts: option.thinking_efforts.clone(),
                            default_thinking_effort: option.default_thinking_effort.clone(),
                        },
                    );
                }
            }
            if let Some(active_id) = requested_model
                .filter(|value| !value.is_empty())
                .or(readiness.model.as_deref())
            {
                let context_window = readiness
                    .models
                    .iter()
                    .find(|option| option.id == active_id)
                    .and_then(|option| option.context_window);
                if details.len() < MAX_MODEL_DETAILS_PER_PROVIDER || details.contains_key(active_id)
                {
                    details.insert(
                        active_id.to_owned(),
                        CachedModelDetails {
                            context_window,
                            image_input: readiness.image_input,
                            thinking_efforts: readiness.thinking_efforts.clone(),
                            default_thinking_effort: readiness.thinking_effort.clone(),
                        },
                    );
                }
            }
            let mut stored = readiness.clone();
            stored.stale = false;
            if !stored.rate_limits.is_empty() {
                guard.rate_limits.insert(
                    key.clone(),
                    CachedRateLimits {
                        limits: stored.rate_limits.clone(),
                        fetched_at: now,
                    },
                );
            } else if let Some(existing_limits) = guard.rate_limits.get(&key) {
                stored.rate_limits = existing_limits.limits.clone();
            }
            for option in &mut stored.models {
                if let Some(learned) = details.get(&option.id) {
                    if option.context_window.is_none() {
                        option.context_window = learned.context_window;
                    }
                    if option.thinking_efforts.is_empty() && !learned.thinking_efforts.is_empty() {
                        option.thinking_efforts = learned.thinking_efforts.clone();
                    }
                    if option.default_thinking_effort.is_none() {
                        option.default_thinking_effort = learned.default_thinking_effort.clone();
                    }
                    option.image_input = option.image_input || learned.image_input;
                }
            }
            guard.providers.insert(
                key,
                CachedProviderEntry {
                    readiness: stored,
                    fetched_at: now,
                    binary_fingerprint: fingerprint,
                    model_details: details,
                },
            );
            guard.clone()
        };
        self.persist(&snapshot);
    }

    pub(crate) fn store_rate_limits(&self, provider: ProviderId, limits: Vec<ProviderRateLimit>) {
        self.store_rate_limits_at(provider, limits, now_secs());
    }

    pub(crate) fn store_rate_limits_at(
        &self,
        provider: ProviderId,
        limits: Vec<ProviderRateLimit>,
        now: u64,
    ) {
        if limits.is_empty() {
            return;
        }
        let snapshot = {
            let mut guard = self
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            guard.version = CACHE_VERSION;
            let key = provider.as_str().to_owned();
            if let Some(entry) = guard.providers.get_mut(&key) {
                entry.readiness.rate_limits = limits.clone();
            }
            guard.rate_limits.insert(
                key,
                CachedRateLimits {
                    limits,
                    fetched_at: now,
                },
            );
            guard.clone()
        };
        self.persist(&snapshot);
    }

    pub(crate) fn rate_limits_cached(&self, provider: ProviderId) -> Vec<ProviderRateLimit> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .rate_limits
            .get(provider.as_str())
            .map(|entry| entry.limits.clone())
            .unwrap_or_default()
    }

    pub(crate) fn rate_limits_need_refresh(&self, provider: ProviderId) -> bool {
        self.rate_limits_need_refresh_at(provider, now_secs())
    }

    pub(crate) fn rate_limits_need_refresh_at(&self, provider: ProviderId, now: u64) -> bool {
        let guard = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(entry) = guard.rate_limits.get(provider.as_str()) else {
            return true;
        };
        now.saturating_sub(entry.fetched_at) > RATE_LIMIT_TTL_SECS
    }

    pub(crate) fn invalidate(&self, provider: ProviderId) {
        let snapshot = {
            let mut guard = self
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let removed = guard.providers.remove(provider.as_str()).is_some();
            if !removed {
                return;
            }
            guard.clone()
        };
        self.persist(&snapshot);
    }

    pub(crate) fn invalidate_all(&self) {
        let snapshot = {
            let mut guard = self
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if guard.providers.is_empty() && guard.rate_limits.is_empty() {
                return;
            }
            guard.providers.clear();
            guard.rate_limits.clear();
            guard.clone()
        };
        self.persist(&snapshot);
    }

    fn persist(&self, cache: &CacheFile) {
        let Some(path) = self.path.as_ref() else {
            return;
        };
        let _ = write_json_atomic(path, cache);
    }
}

fn project_model(
    provider: ProviderId,
    entry: &CachedProviderEntry,
    requested_model: Option<&str>,
) -> Option<(ProviderReadiness, bool)> {
    let mut ready = entry.readiness.clone();
    for option in &mut ready.models {
        if let Some(learned) = entry.model_details.get(&option.id) {
            if option.context_window.is_none() {
                option.context_window = learned.context_window;
            }
            if option.thinking_efforts.is_empty() && !learned.thinking_efforts.is_empty() {
                option.thinking_efforts = learned.thinking_efforts.clone();
            }
            if option.default_thinking_effort.is_none() {
                option.default_thinking_effort = learned.default_thinking_effort.clone();
            }
            option.image_input = option.image_input || learned.image_input;
        }
    }
    let Some(requested) = requested_model.filter(|value| !value.is_empty()) else {
        return Some((ready, false));
    };
    if ready.models.is_empty() {
        return if ready.model.as_deref() == Some(requested) {
            Some((ready, false))
        } else {
            None
        };
    }
    let selected = ready
        .models
        .iter()
        .find(|option| option.id == requested)?
        .clone();
    ready.model = Some(selected.id.clone());
    ready.image_input = selected.image_input;
    ready.thinking_efforts = selected.thinking_efforts.clone();
    ready.thinking_effort = selected.default_thinking_effort.clone();
    let needs_model_refresh = provider.capabilities().per_model_metadata_probe
        && !entry.model_details.contains_key(requested);
    Some((ready, needs_model_refresh))
}

fn load_from_disk(path: &Path) -> CacheFile {
    let Ok(bytes) = fs::read(path) else {
        return CacheFile {
            version: CACHE_VERSION,
            ..CacheFile::default()
        };
    };
    let Ok(mut parsed) = serde_json::from_slice::<CacheFile>(&bytes) else {
        return CacheFile {
            version: CACHE_VERSION,
            ..CacheFile::default()
        };
    };
    if parsed.version != CACHE_VERSION {
        return CacheFile {
            version: CACHE_VERSION,
            ..CacheFile::default()
        };
    }
    parsed
        .providers
        .retain(|_, entry| entry.readiness.status == "ready");
    parsed
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::ModelOption;

    fn sample_readiness() -> ProviderReadiness {
        let mut ready = ProviderReadiness::new("ready", "Codex is ready.", "");
        ready.image_transport = true;
        ready.image_input = true;
        ready.model = Some("model-a".into());
        ready.thinking_effort = Some("high".into());
        ready.thinking_efforts = vec!["low".into(), "high".into()];
        ready.models = vec![
            ModelOption {
                id: "model-a".into(),
                display_name: "Model A".into(),
                context_window: Some(200_000),
                image_input: true,
                thinking_efforts: vec!["low".into(), "high".into()],
                default_thinking_effort: Some("high".into()),
            },
            ModelOption {
                id: "model-b".into(),
                display_name: "Model B".into(),
                context_window: Some(128_000),
                image_input: false,
                thinking_efforts: vec!["medium".into()],
                default_thinking_effort: Some("medium".into()),
            },
        ];
        ready
    }

    #[test]
    fn cache_projects_same_engine_model_switch_fresh_and_marks_expired_entries_stale() {
        let store = ReadinessCacheStore::memory();
        let fp = Some("codex.exe|100|5".to_owned());
        store.store_at(
            ProviderId::Codex,
            fp.clone(),
            &sample_readiness(),
            None,
            1_000,
        );

        let hit = store.lookup_at(ProviderId::Codex, fp.as_deref(), Some("model-b"), 1_100);
        let CacheHit::Fresh(projected) = hit else {
            panic!("expected fresh cache hit for model-b");
        };
        assert_eq!(projected.model.as_deref(), Some("model-b"));
        assert!(!projected.image_input);
        assert_eq!(projected.thinking_efforts, vec!["medium"]);
        assert_eq!(projected.thinking_effort.as_deref(), Some("medium"));
        assert!(!projected.stale);

        let stale = store.lookup_at(
            ProviderId::Codex,
            fp.as_deref(),
            Some("model-a"),
            1_000 + READINESS_FRESH_TTL_SECS + 1,
        );
        let CacheHit::Stale(stale_ready) = stale else {
            panic!("expected stale SWR hit after TTL");
        };
        assert!(stale_ready.stale);
        assert_eq!(stale_ready.models.len(), 2);

        assert!(matches!(
            store.lookup_at(ProviderId::Codex, Some("codex.exe|200|9"), None, 1_100),
            CacheHit::Miss
        ));
    }

    #[test]
    fn cache_persists_to_disk_merges_rate_limits_and_never_caches_errors() {
        let root = std::env::temp_dir().join(format!(
            "otto-cache-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let path = root.join("readiness-cache.json");
        let store = ReadinessCacheStore::file(path.clone());
        let error = ProviderReadiness::new("authRequired", "Needs sign-in", "Login");
        store.store_at(ProviderId::Codex, Some("fp".into()), &error, None, 1_000);
        assert!(matches!(
            store.lookup_at(ProviderId::Codex, Some("fp"), None, 1_001),
            CacheHit::Miss
        ));

        store.store_at(
            ProviderId::Codex,
            Some("fp".into()),
            &sample_readiness(),
            None,
            1_000,
        );
        store.store_rate_limits_at(
            ProviderId::Codex,
            vec![ProviderRateLimit {
                id: "codex:5h".into(),
                label: "5h limit".into(),
                window: "5h".into(),
                used_percent: 25,
                remaining_percent: 75,
                resets_at: None,
                group: None,
            }],
            1_010,
        );

        let reloaded = ReadinessCacheStore::file(path);
        let CacheHit::Fresh(hit) =
            reloaded.lookup_at(ProviderId::Codex, Some("fp"), Some("model-a"), 1_050)
        else {
            panic!("expected persisted disk cache hit");
        };
        assert_eq!(hit.rate_limits.len(), 1);
        assert_eq!(hit.rate_limits[0].used_percent, 25);
        assert!(!reloaded.rate_limits_need_refresh_at(ProviderId::Codex, 1_050));
        assert!(
            reloaded
                .rate_limits_need_refresh_at(ProviderId::Codex, 1_010 + RATE_LIMIT_TTL_SECS + 1)
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn pi_or_acp_unprobed_model_serves_immediately_as_stale_then_fresh_after_learning() {
        let store = ReadinessCacheStore::memory();
        let mut pi_ready = sample_readiness();
        pi_ready.models[1].thinking_efforts.clear();
        pi_ready.models[1].default_thinking_effort = None;
        store.store_at(
            ProviderId::Pi,
            Some("pi".into()),
            &pi_ready,
            Some("model-a"),
            1_000,
        );

        let first = store.lookup_at(ProviderId::Pi, Some("pi"), Some("model-b"), 1_010);
        assert!(matches!(first, CacheHit::Stale(_)));

        let mut learned = pi_ready.clone();
        learned.model = Some("model-b".into());
        learned.thinking_efforts = vec!["low".into(), "high".into()];
        learned.thinking_effort = Some("low".into());
        store.store_at(
            ProviderId::Pi,
            Some("pi".into()),
            &learned,
            Some("model-b"),
            1_020,
        );

        let second = store.lookup_at(ProviderId::Pi, Some("pi"), Some("model-b"), 1_030);
        let CacheHit::Fresh(resolved) = second else {
            panic!("expected fresh hit after learning model-b details");
        };
        assert_eq!(resolved.thinking_efforts, vec!["low", "high"]);
        assert_eq!(resolved.thinking_effort.as_deref(), Some("low"));
    }
}
