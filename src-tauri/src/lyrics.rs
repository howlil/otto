use crate::media::{MediaRuntime, MediaSnapshot, MediaStatus, track_key};
use serde::{Deserialize, Serialize};
use std::{
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsRecord {
    pub track_name: String,
    pub artist_name: String,
    pub album_name: String,
    pub duration: f64,
    pub instrumental: bool,
    pub plain_lyrics: Option<String>,
    pub synced_lyrics: Option<String>,
}

fn normalized(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

const DISPLAY_ARTIST_SEPARATORS: [&str; 3] = [" - ", " — ", " – "];

fn has_display_artist(snapshot: &MediaSnapshot) -> bool {
    snapshot
        .album
        .as_ref()
        .is_none_or(|album| album.trim().is_empty())
        && snapshot.duration_ms.is_some()
        && snapshot.artist.as_ref().is_some_and(|artist| {
            DISPLAY_ARTIST_SEPARATORS
                .iter()
                .any(|separator| artist.contains(separator))
        })
}

fn matches_artist(record: &LyricsRecord, snapshot: &MediaSnapshot) -> bool {
    let Some(artist) = snapshot.artist.as_ref() else {
        return false;
    };
    normalized(artist) == normalized(&record.artist_name)
        || (has_display_artist(snapshot)
            && !record.artist_name.trim().is_empty()
            && !record.album_name.trim().is_empty()
            && DISPLAY_ARTIST_SEPARATORS.iter().any(|separator| {
                normalized(artist)
                    == normalized(&format!(
                        "{}{separator}{}",
                        record.artist_name, record.album_name
                    ))
            }))
}

fn matches_track(record: &LyricsRecord, snapshot: &MediaSnapshot) -> bool {
    snapshot
        .title
        .as_ref()
        .is_some_and(|title| normalized(title) == normalized(&record.track_name))
        && matches_artist(record, snapshot)
        && snapshot
            .album
            .as_ref()
            .filter(|album| !album.trim().is_empty())
            .is_none_or(|album| normalized(album) == normalized(&record.album_name))
        && record.duration.is_finite()
        && (1.0..=3600.0).contains(&record.duration)
        && snapshot
            .duration_ms
            .is_none_or(|duration| (record.duration - duration as f64 / 1000.0).abs() <= 2.0)
}

fn select_search_result(
    records: Vec<LyricsRecord>,
    snapshot: &MediaSnapshot,
) -> Option<LyricsRecord> {
    if records.len() > 20 || (snapshot.duration_ms.is_none() && records.len() == 20) {
        return None;
    }
    let mut candidates: Vec<_> = records
        .into_iter()
        .filter(|record| matches_track(record, snapshot))
        .collect();
    if snapshot.duration_ms.is_none() && candidates.len() != 1 {
        return None;
    }
    if has_display_artist(snapshot)
        && let Some(first) = candidates.first()
        && candidates.iter().any(|candidate| {
            normalized(&candidate.artist_name) != normalized(&first.artist_name)
                || normalized(&candidate.album_name) != normalized(&first.album_name)
        })
    {
        return None;
    }
    candidates.sort_by(|left, right| {
        let quality = |record: &LyricsRecord| {
            (
                record
                    .synced_lyrics
                    .as_ref()
                    .is_some_and(|text| !text.trim().is_empty()),
                record.plain_lyrics.is_some(),
            )
        };
        quality(right).cmp(&quality(left))
    });
    candidates.into_iter().next()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsResult {
    pub key: String,
    pub record: Option<LyricsRecord>,
}

#[derive(Default)]
struct LookupState {
    cached: Option<LyricsResult>,
    retry_at: Option<Instant>,
}

pub struct LyricsRuntime {
    enabled: AtomicBool,
    revision: AtomicU64,
    client: Result<reqwest::Client, reqwest::Error>,
    state: tokio::sync::Mutex<LookupState>,
}

impl LyricsRuntime {
    pub fn new() -> Self {
        Self {
            enabled: AtomicBool::new(false),
            revision: AtomicU64::new(0),
            client: reqwest::Client::builder()
                .user_agent(concat!(
                    "Otto/",
                    env!("CARGO_PKG_VERSION"),
                    " (https://github.com/howlil/otto)"
                ))
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(3))
                .timeout(Duration::from_secs(8))
                .build(),
            state: tokio::sync::Mutex::new(LookupState::default()),
        }
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::SeqCst);
        self.revision.fetch_add(1, Ordering::SeqCst);
    }

    pub async fn lookup(
        &self,
        media: &MediaRuntime,
        refresh: bool,
    ) -> Result<LyricsResult, String> {
        tokio::time::timeout(
            Duration::from_secs(8),
            self.lookup_at(media, refresh, "https://lrclib.net/api/get"),
        )
        .await
        .map_err(|_| "Lyrics lookup timed out. Retry lyrics.".to_string())?
    }

    async fn lookup_at(
        &self,
        media: &MediaRuntime,
        refresh: bool,
        endpoint: &str,
    ) -> Result<LyricsResult, String> {
        let mut state = self.state.lock().await;
        if !self.enabled.load(Ordering::SeqCst) {
            return Err("Open Lyrics before searching LRCLIB.".into());
        }
        let revision = self.revision.load(Ordering::SeqCst);
        let snapshot = media.snapshot();
        let title = snapshot.title.as_deref().filter(|s| !s.trim().is_empty());
        let artist = snapshot.artist.as_deref().filter(|s| !s.trim().is_empty());
        let (Some(title), Some(artist)) = (title, artist) else {
            return Err("Lyrics need a title and artist from the player.".into());
        };
        if snapshot.status != MediaStatus::Available
            || snapshot
                .duration_ms
                .is_some_and(|duration| !(1000..=3_600_000).contains(&duration))
            || title.len() > 1024
            || artist.len() > 1024
        {
            return Err("This media item cannot be matched to lyrics.".into());
        }
        let key = track_key(&snapshot);
        if !refresh
            && let Some(cached) = &state.cached
            && cached.key == key
        {
            return Ok(cached.clone());
        }
        if state
            .retry_at
            .is_some_and(|deadline| Instant::now() < deadline)
        {
            return Err("LRCLIB is rate limited. Please wait before retrying.".into());
        }
        let duration = snapshot
            .duration_ms
            .map(|duration| (duration as f64 / 1000.0).to_string());
        let mut query = vec![("track_name", title), ("artist_name", artist)];
        if let Some(duration) = duration.as_deref() {
            query.push(("duration", duration));
        }
        if let Some(album) = snapshot
            .album
            .as_deref()
            .filter(|s| !s.trim().is_empty() && s.len() <= 1024)
        {
            query.push(("album_name", album));
        }
        let mut record = if duration.is_some() {
            match self.fetch(endpoint, &query, &mut state).await? {
                Some(body) => {
                    let record: LyricsRecord = serde_json::from_slice(&body)
                        .map_err(|_| "LRCLIB returned invalid lyrics.".to_string())?;
                    matches_track(&record, &snapshot).then_some(record)
                }
                None => None,
            }
        } else {
            None
        };
        if record.is_none() {
            self.ensure_current(media, revision, &key)?;
            query.retain(|(name, _)| *name != "duration");
            if has_display_artist(&snapshot) {
                query.retain(|(name, _)| *name != "artist_name");
            }
            let search = format!(
                "{}/search",
                endpoint
                    .rsplit_once('/')
                    .ok_or("Invalid lyrics endpoint.")?
                    .0
            );
            if let Some(body) = self.fetch(&search, &query, &mut state).await? {
                let records: Vec<LyricsRecord> = serde_json::from_slice(&body)
                    .map_err(|_| "LRCLIB returned invalid lyrics.".to_string())?;
                record = select_search_result(records, &snapshot);
            }
        }
        self.ensure_current(media, revision, &key)?;
        let result = LyricsResult { key, record };
        state.cached = Some(result.clone());
        Ok(result)
    }

    fn ensure_current(&self, media: &MediaRuntime, revision: u64, key: &str) -> Result<(), String> {
        if !self.enabled.load(Ordering::SeqCst)
            || revision != self.revision.load(Ordering::SeqCst)
            || track_key(&media.snapshot()) != key
        {
            return Err("The media item or lyrics permission changed.".into());
        }
        Ok(())
    }

    async fn fetch(
        &self,
        endpoint: &str,
        query: &[(&str, &str)],
        state: &mut LookupState,
    ) -> Result<Option<Vec<u8>>, String> {
        let client = self
            .client
            .as_ref()
            .map_err(|_| "Online lyrics could not initialize.".to_string())?;
        let mut response = client
            .get(endpoint)
            .query(&query)
            .send()
            .await
            .map_err(|_| {
                "LRCLIB could not be reached. Check your connection and retry.".to_string()
            })?;
        if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let seconds = response
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(60)
                .max(1);
            state.retry_at = Instant::now().checked_add(Duration::from_secs(seconds));
            return Err("LRCLIB is rate limited. Please wait before retrying.".into());
        }
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            Ok(None)
        } else {
            if !response.status().is_success() {
                return Err("LRCLIB is unavailable. Try again later.".into());
            }
            let mut body = Vec::new();
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|_| "Lyrics download was interrupted.".to_string())?
            {
                if body.len() + chunk.len() > 512 * 1024 {
                    return Err("The lyrics response was too large.".into());
                }
                body.extend_from_slice(&chunk);
            }
            Ok(Some(body))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn observed() -> MediaSnapshot {
        let mut snapshot = MediaSnapshot::loading();
        snapshot.status = MediaStatus::Available;
        snapshot.title = Some("Orbit".into());
        snapshot.artist = Some("Otto".into());
        snapshot.album = Some("Signals".into());
        snapshot.duration_ms = Some(232_000);
        snapshot
    }

    fn server(
        status: &str,
        body: String,
        on_request: impl FnOnce(String) + Send + 'static,
    ) -> (String, std::thread::JoinHandle<()>) {
        let mut on_request = Some(on_request);
        let mut responses = vec![(status.to_string(), body.clone())];
        if status == "404 Not Found" {
            responses.push((status.to_string(), body));
        }
        server_steps(responses, move |request| {
            if let Some(callback) = on_request.take() {
                callback(request);
            }
        })
    }

    fn server_steps(
        responses: Vec<(String, String)>,
        mut on_request: impl FnMut(String) + Send + 'static,
    ) -> (String, std::thread::JoinHandle<()>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/api/get", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            for (status, body) in responses {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut request = vec![0; 8192];
                let count = stream.read(&mut request).unwrap();
                on_request(String::from_utf8_lossy(&request[..count]).to_string());
                write!(stream, "HTTP/1.1 {status}\r\nContent-Length: {}\r\nContent-Type: application/json\r\nRetry-After: 60\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            }
        });
        (endpoint, handle)
    }

    fn record_json() -> String {
        serde_json::json!({"trackName":"Orbit", "artistName":"Otto", "albumName":"Signals", "duration":232, "instrumental":false, "plainLyrics":"Words", "syncedLyrics":"[00:01.00]Words"}).to_string()
    }

    #[tokio::test]
    async fn online_lyrics_require_an_active_view_lease_before_network() {
        let media = MediaRuntime::new();
        media.publish(observed());
        let runtime = LyricsRuntime::new();
        let result = runtime.lookup_at(&media, false, "http://127.0.0.1:1").await;
        assert!(result.err().unwrap().contains("Open Lyrics"));
    }

    #[tokio::test]
    async fn display_artist_finds_only_verified_album_and_duration_from_any_source() {
        let media = MediaRuntime::new();
        let mut snapshot = observed();
        snapshot.source_id = Some("BrowserMediaSession".into());
        snapshot.artist = Some("Otto — Signals".into());
        snapshot.album = None;
        media.publish(snapshot.clone());
        let runtime = LyricsRuntime::new();
        runtime.set_enabled(true);
        let valid: serde_json::Value = serde_json::from_str(&record_json()).unwrap();
        let mut wrong_album = valid.clone();
        wrong_album["albumName"] = serde_json::json!("Other");
        let mut wrong_duration = valid.clone();
        wrong_duration["duration"] = serde_json::json!(300);
        let mut wrong_artist = valid.clone();
        wrong_artist["artistName"] = serde_json::json!("Other");
        let mut wrong_title = valid.clone();
        wrong_title["trackName"] = serde_json::json!("Other");
        let requests = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let observed_requests = requests.clone();
        let (endpoint, server) = server_steps(
            vec![
                ("404 Not Found".into(), "{}".into()),
                (
                    "200 OK".into(),
                    serde_json::json!([
                        wrong_album,
                        wrong_duration,
                        wrong_artist,
                        wrong_title,
                        valid
                    ])
                    .to_string(),
                ),
            ],
            move |request| observed_requests.lock().unwrap().push(request),
        );
        let result = runtime.lookup_at(&media, false, &endpoint).await.unwrap();
        server.join().unwrap();
        assert_eq!(result.key, track_key(&snapshot));
        let record = result
            .record
            .expect("verified lyrics for the observed media");
        assert_eq!(record.track_name, "Orbit");
        assert_eq!(record.artist_name, "Otto");
        assert_eq!(record.album_name, "Signals");
        assert_eq!(record.duration, 232.0);
        assert_eq!(record.synced_lyrics.as_deref(), Some("[00:01.00]Words"));
        assert_eq!(media.snapshot().artist, snapshot.artist);
        let requests = requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests[1].starts_with("GET /api/search?"));
        assert!(requests[1].contains("track_name=Orbit"));
        assert!(!requests[1].contains("artist_name="));
        assert!(!requests[1].contains("album_name="));
    }

    #[test]
    fn combined_artist_requires_known_duration_and_missing_album_not_a_player_name() {
        let record: LyricsRecord = serde_json::from_str(&record_json()).unwrap();
        let mut snapshot = observed();
        snapshot.source_id = Some("AppleInc.AppleMusicWin_nzyj5cx40ttqa!App".into());
        snapshot.artist = Some("Otto - Signals".into());
        snapshot.album = None;
        for separator in [" - ", " — ", " – "] {
            snapshot.artist = Some(format!("Otto{separator}Signals"));
            assert!(matches_track(&record, &snapshot));
        }
        snapshot.artist = Some("Otto - Signals".into());
        let mut other = snapshot.clone();
        other.source_id = Some("OtherPlayer".into());
        assert!(matches_track(&record, &other));
        other.source_id = None;
        assert!(matches_track(&record, &other));
        other = snapshot.clone();
        other.duration_ms = None;
        assert!(!matches_track(&record, &other));
        other = snapshot.clone();
        other.album = Some("Signals".into());
        assert!(!matches_track(&record, &other));
        other = snapshot.clone();
        other.artist = Some("Otto - Other".into());
        assert!(!matches_track(&record, &other));
        other = snapshot;
        other.artist = Some("Otto".into());
        assert!(matches_track(&record, &other));
    }

    #[test]
    fn combined_artist_rejects_ambiguous_splits_and_preserves_hyphenated_names() {
        let mut snapshot = observed();
        snapshot.source_id = Some("AppleInc.AppleMusicWin_nzyj5cx40ttqa!App".into());
        snapshot.artist = Some("Otto - Ensemble - Signals".into());
        snapshot.album = None;
        let mut record: LyricsRecord = serde_json::from_str(&record_json()).unwrap();
        record.artist_name = "Otto - Ensemble".into();
        assert!(select_search_result(vec![record.clone()], &snapshot).is_some());
        let mut ambiguous = record.clone();
        ambiguous.artist_name = "Otto".into();
        ambiguous.album_name = "Ensemble - Signals".into();
        assert!(select_search_result(vec![record.clone(), ambiguous], &snapshot).is_none());
        assert!(select_search_result(vec![record.clone(), record], &snapshot).is_some());
    }

    #[tokio::test]
    async fn missing_player_duration_uses_search_and_accepts_only_a_unique_identity() {
        let media = MediaRuntime::new();
        let mut snapshot = observed();
        snapshot.duration_ms = None;
        media.publish(snapshot);
        let runtime = LyricsRuntime::new();
        runtime.set_enabled(true);
        let (endpoint, server) = server("200 OK", format!("[{}]", record_json()), |request| {
            assert!(request.starts_with("GET /api/search?"));
            assert!(!request.contains("duration="));
        });
        let result = runtime.lookup_at(&media, false, &endpoint).await.unwrap();
        assert_eq!(
            result.record.unwrap().synced_lyrics.as_deref(),
            Some("[00:01.00]Words")
        );
        server.join().unwrap();
    }

    #[tokio::test]
    async fn missing_exact_lookup_searches_and_rejects_wrong_versions() {
        let media = MediaRuntime::new();
        media.publish(observed());
        let runtime = LyricsRuntime::new();
        runtime.set_enabled(true);
        let valid: serde_json::Value = serde_json::from_str(&record_json()).unwrap();
        let mut wrong = valid.clone();
        wrong["duration"] = serde_json::json!(300);
        let mut other_artist = valid.clone();
        other_artist["artistName"] = serde_json::json!("Other");
        let (endpoint, server) = server_steps(
            vec![
                ("404 Not Found".into(), "{}".into()),
                (
                    "200 OK".into(),
                    serde_json::json!([wrong, other_artist, valid]).to_string(),
                ),
            ],
            |_| {},
        );
        let result = runtime.lookup_at(&media, false, &endpoint).await.unwrap();
        assert_eq!(result.record.unwrap().duration, 232.0);
        server.join().unwrap();
    }

    #[tokio::test]
    async fn unknown_duration_rejects_ambiguous_versions_and_foreign_tracks() {
        for body in [
            format!("[{},{}]", record_json(), record_json()),
            format!("[{}]", record_json().replace("Otto", "Other")),
        ] {
            let media = MediaRuntime::new();
            let mut snapshot = observed();
            snapshot.duration_ms = None;
            media.publish(snapshot);
            let runtime = LyricsRuntime::new();
            runtime.set_enabled(true);
            let (endpoint, server) = server("200 OK", body, |_| {});
            assert!(
                runtime
                    .lookup_at(&media, false, &endpoint)
                    .await
                    .unwrap()
                    .record
                    .is_none()
            );
            server.join().unwrap();
        }
    }

    #[tokio::test]
    async fn permission_revoked_during_exact_lookup_prevents_search_egress() {
        let media = MediaRuntime::new();
        media.publish(observed());
        let runtime = std::sync::Arc::new(LyricsRuntime::new());
        runtime.set_enabled(true);
        let changed = runtime.clone();
        let (endpoint, server) =
            server_steps(vec![("404 Not Found".into(), "{}".into())], move |_| {
                changed.set_enabled(false)
            });
        assert!(
            runtime
                .lookup_at(&media, false, &endpoint)
                .await
                .err()
                .unwrap()
                .contains("changed")
        );
        server.join().unwrap();
    }

    #[tokio::test]
    async fn lyrics_http_query_is_encoded_and_success_is_cached() {
        let media = MediaRuntime::new();
        media.publish(observed());
        let runtime = LyricsRuntime::new();
        runtime.set_enabled(true);
        let (endpoint, server) = server("200 OK", record_json(), |request| {
            assert!(request.contains("track_name=Orbit"));
            assert!(request.contains("album_name=Signals"));
            assert!(request.contains("duration=232"));
            assert!(request.to_lowercase().contains("user-agent: otto/"));
        });
        let result = runtime.lookup_at(&media, false, &endpoint).await.unwrap();
        server.join().unwrap();
        assert_eq!(
            result.record.unwrap().synced_lyrics.as_deref(),
            Some("[00:01.00]Words")
        );
        assert!(
            runtime
                .lookup_at(&media, false, "http://127.0.0.1:1")
                .await
                .unwrap()
                .record
                .is_some()
        );
    }

    #[tokio::test]
    async fn lyrics_discard_late_results_after_track_or_permission_changes() {
        for disable in [false, true] {
            let media = std::sync::Arc::new(MediaRuntime::new());
            media.publish(observed());
            let runtime = std::sync::Arc::new(LyricsRuntime::new());
            runtime.set_enabled(true);
            let changed_media = media.clone();
            let changed_runtime = runtime.clone();
            let (endpoint, server) = server("200 OK", record_json(), move |_| {
                if disable {
                    changed_runtime.set_enabled(false);
                } else {
                    changed_media.publish(MediaSnapshot::unavailable("No session"));
                }
            });
            assert!(
                runtime
                    .lookup_at(&media, false, &endpoint)
                    .await
                    .err()
                    .unwrap()
                    .contains("changed")
            );
            server.join().unwrap();
        }
    }

    #[tokio::test]
    async fn lyrics_distinguish_missing_invalid_and_rate_limited_responses() {
        for (status, body, expected) in [
            ("404 Not Found", "{}".into(), "missing"),
            ("200 OK", "not json".into(), "invalid"),
            ("429 Too Many Requests", "{}".into(), "rate limited"),
            ("200 OK", "x".repeat(512 * 1024 + 1), "too large"),
        ] {
            let media = MediaRuntime::new();
            media.publish(observed());
            let runtime = LyricsRuntime::new();
            runtime.set_enabled(true);
            let (endpoint, server) = server(status, body, |_| {});
            let result = runtime.lookup_at(&media, false, &endpoint).await;
            if expected == "missing" {
                assert!(result.unwrap().record.is_none());
            } else {
                assert!(result.err().unwrap().contains(expected));
            }
            server.join().unwrap();
            if expected == "rate limited" {
                assert!(
                    runtime
                        .lookup_at(&media, true, "http://127.0.0.1:1")
                        .await
                        .err()
                        .unwrap()
                        .contains("rate limited")
                );
            }
        }
    }

    #[test]
    fn lyrics_match_identity_and_duration_not_just_title() {
        let mut snapshot = MediaSnapshot::loading();
        snapshot.title = Some("Orbit".into());
        snapshot.artist = Some("Otto".into());
        snapshot.album = Some("Signals".into());
        snapshot.duration_ms = Some(232_000);
        let mut record = LyricsRecord {
            track_name: "Orbit".into(),
            artist_name: "Otto".into(),
            album_name: "Signals".into(),
            duration: 233.0,
            instrumental: false,
            plain_lyrics: Some("Words".into()),
            synced_lyrics: None,
        };
        assert!(matches_track(&record, &snapshot));
        record.duration = 240.0;
        assert!(!matches_track(&record, &snapshot));
        record.duration = 232.0;
        record.track_name = "Orbit (Live)".into();
        assert!(!matches_track(&record, &snapshot));
        record.track_name = "Orbit".into();
        record.artist_name = "Other".into();
        assert!(!matches_track(&record, &snapshot));
    }
}
