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

fn matches_track(record: &LyricsRecord, snapshot: &MediaSnapshot) -> bool {
    snapshot
        .title
        .as_ref()
        .is_some_and(|title| normalized(title) == normalized(&record.track_name))
        && snapshot
            .artist
            .as_ref()
            .is_some_and(|artist| normalized(artist) == normalized(&record.artist_name))
        && snapshot
            .album
            .as_ref()
            .filter(|album| !album.trim().is_empty())
            .is_none_or(|album| normalized(album) == normalized(&record.album_name))
        && snapshot.duration_ms.is_some_and(|duration| {
            record.duration.is_finite() && (record.duration - duration as f64 / 1000.0).abs() <= 2.0
        })
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
        self.lookup_at(media, refresh, "https://lrclib.net/api/get")
            .await
    }

    async fn lookup_at(
        &self,
        media: &MediaRuntime,
        refresh: bool,
        endpoint: &str,
    ) -> Result<LyricsResult, String> {
        let mut state = self.state.lock().await;
        if !self.enabled.load(Ordering::SeqCst) {
            return Err("Enable online lyrics before searching LRCLIB.".into());
        }
        let revision = self.revision.load(Ordering::SeqCst);
        let snapshot = media.snapshot();
        let title = snapshot.title.as_deref().filter(|s| !s.trim().is_empty());
        let artist = snapshot.artist.as_deref().filter(|s| !s.trim().is_empty());
        let (Some(title), Some(artist), Some(duration)) = (title, artist, snapshot.duration_ms)
        else {
            return Err("Lyrics need a title, artist and known duration from the player.".into());
        };
        if snapshot.status != MediaStatus::Available
            || !(1000..=3_600_000).contains(&duration)
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
        let duration = (duration as f64 / 1000.0).to_string();
        let mut query = vec![
            ("track_name", title),
            ("artist_name", artist),
            ("duration", &duration),
        ];
        if let Some(album) = snapshot
            .album
            .as_deref()
            .filter(|s| !s.trim().is_empty() && s.len() <= 1024)
        {
            query.push(("album_name", album));
        }
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
        let record = if response.status() == reqwest::StatusCode::NOT_FOUND {
            None
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
            let record: LyricsRecord = serde_json::from_slice(&body)
                .map_err(|_| "LRCLIB returned invalid lyrics.".to_string())?;
            matches_track(&record, &snapshot).then_some(record)
        };
        if !self.enabled.load(Ordering::SeqCst)
            || revision != self.revision.load(Ordering::SeqCst)
            || track_key(&media.snapshot()) != key
        {
            return Err("The media item or lyrics permission changed.".into());
        }
        let result = LyricsResult { key, record };
        state.cached = Some(result.clone());
        Ok(result)
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
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/api/get", listener.local_addr().unwrap());
        let status = status.to_string();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut request = vec![0; 8192];
            let count = stream.read(&mut request).unwrap();
            on_request(String::from_utf8_lossy(&request[..count]).to_string());
            write!(stream, "HTTP/1.1 {status}\r\nContent-Length: {}\r\nContent-Type: application/json\r\nRetry-After: 60\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        });
        (endpoint, handle)
    }

    fn record_json() -> String {
        serde_json::json!({"trackName":"Orbit", "artistName":"Otto", "albumName":"Signals", "duration":232, "instrumental":false, "plainLyrics":"Words", "syncedLyrics":"[00:01.00]Words"}).to_string()
    }

    #[tokio::test]
    async fn online_lyrics_require_explicit_permission_before_network() {
        let media = MediaRuntime::new();
        media.publish(observed());
        let runtime = LyricsRuntime::new();
        let result = runtime.lookup_at(&media, false, "http://127.0.0.1:1").await;
        assert!(result.err().unwrap().contains("Enable online lyrics"));
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
