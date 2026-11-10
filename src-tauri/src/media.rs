use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
};
use tauri::ipc::Channel;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaControls {
    pub toggle: bool,
    pub previous: bool,
    pub next: bool,
    pub seek: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaStatus {
    Loading,
    Available,
    Unavailable,
    Unsupported,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaPlayback {
    Playing,
    Paused,
    Stopped,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MediaAction {
    Toggle,
    Previous,
    Next,
    Seek(u64),
}

impl MediaAction {
    pub fn parse(command: &str, position_ms: Option<u64>) -> Result<Self, String> {
        match command {
            "toggle" => Ok(Self::Toggle),
            "previous" => Ok(Self::Previous),
            "next" => Ok(Self::Next),
            "seek" => position_ms
                .map(Self::Seek)
                .ok_or_else(|| "Seeking requires a playback position.".to_string()),
            _ => Err("Unsupported media action.".to_string()),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSnapshot {
    pub seq: u64,
    pub status: MediaStatus,
    pub playback: MediaPlayback,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub source_id: Option<String>,
    pub session_revision: Option<u64>,
    pub observed_at_ms: Option<u64>,
    pub playback_rate: Option<f64>,
    pub artwork_data_url: Option<String>,
    pub position_ms: Option<u64>,
    pub duration_ms: Option<u64>,
    pub min_seek_ms: Option<u64>,
    pub max_seek_ms: Option<u64>,
    pub controls: MediaControls,
    pub message: String,
}

pub fn track_key(snapshot: &MediaSnapshot) -> String {
    serde_json::to_string(&(
        &snapshot.source_id,
        &snapshot.title,
        &snapshot.artist,
        &snapshot.album,
        snapshot.duration_ms,
        snapshot.session_revision,
    ))
    .unwrap()
}

impl MediaSnapshot {
    pub fn validate_action(&self, action: MediaAction, expected_track: &str) -> Result<(), String> {
        if self.status != MediaStatus::Available || track_key(self) != expected_track {
            return Err("The media item changed. Refresh Music before trying again.".to_string());
        }
        let supported =
            match action {
                MediaAction::Toggle => self.controls.toggle,
                MediaAction::Previous => self.controls.previous,
                MediaAction::Next => self.controls.next,
                MediaAction::Seek(position) => {
                    self.controls.seek
                        && self.min_seek_ms.zip(self.max_seek_ms).is_some_and(
                            |(minimum, maximum)| position >= minimum && position <= maximum,
                        )
                }
            };
        supported
            .then_some(())
            .ok_or_else(|| "That media action is not supported by the current session.".to_string())
    }

    pub fn loading() -> Self {
        Self {
            seq: 0,
            status: MediaStatus::Loading,
            playback: MediaPlayback::Unknown,
            title: None,
            artist: None,
            album: None,
            source_id: None,
            session_revision: None,
            observed_at_ms: None,
            playback_rate: None,
            artwork_data_url: None,
            position_ms: None,
            duration_ms: None,
            min_seek_ms: None,
            max_seek_ms: None,
            controls: MediaControls::default(),
            message: "Checking system media.".to_string(),
        }
    }

    pub fn unavailable(message: impl Into<String>) -> Self {
        Self {
            status: MediaStatus::Unavailable,
            message: message.into(),
            ..Self::loading()
        }
    }

    pub fn unsupported(message: impl Into<String>) -> Self {
        Self {
            status: MediaStatus::Unsupported,
            message: message.into(),
            ..Self::loading()
        }
    }
}

pub struct MediaRuntime {
    state: Mutex<MediaState>,
    next_subscription: AtomicU64,
}

struct MediaState {
    snapshot: MediaSnapshot,
    subscribers: HashMap<u64, Channel<MediaSnapshot>>,
}

impl Default for MediaRuntime {
    fn default() -> Self {
        Self {
            state: Mutex::new(MediaState {
                snapshot: MediaSnapshot::loading(),
                subscribers: HashMap::new(),
            }),
            next_subscription: AtomicU64::new(0),
        }
    }
}

impl MediaRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn snapshot(&self) -> MediaSnapshot {
        self.state.lock().unwrap().snapshot.clone()
    }

    pub fn subscribe(&self, channel: Channel<MediaSnapshot>) -> u64 {
        let id = self.next_subscription.fetch_add(1, Ordering::SeqCst) + 1;
        let mut state = self.state.lock().unwrap();
        let current = state.snapshot.clone();
        state.subscribers.insert(id, channel);
        if let Some(channel) = state.subscribers.get(&id) {
            let _ = channel.send(current);
        }
        id
    }

    pub fn unsubscribe(&self, subscription_id: u64) {
        self.state
            .lock()
            .unwrap()
            .subscribers
            .remove(&subscription_id);
    }

    pub fn publish(&self, mut snapshot: MediaSnapshot) -> MediaSnapshot {
        let mut state = self.state.lock().unwrap();
        snapshot.seq = state.snapshot.seq.saturating_add(1);
        state.snapshot = snapshot;
        let published = state.snapshot.clone();
        for channel in state.subscribers.values() {
            let _ = channel.send(published.clone());
        }
        published
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn publication_replaces_the_observed_media_projection() {
        let runtime = MediaRuntime::new();
        let observed = MediaSnapshot {
            seq: 0,
            status: MediaStatus::Available,
            playback: MediaPlayback::Playing,
            title: Some("Orbit".to_string()),
            artist: Some("Otto".to_string()),
            album: None,
            source_id: None,
            session_revision: None,
            observed_at_ms: None,
            playback_rate: None,
            artwork_data_url: None,
            position_ms: Some(1_200),
            duration_ms: Some(3_600),
            min_seek_ms: Some(0),
            max_seek_ms: Some(3_600),
            controls: MediaControls {
                toggle: true,
                previous: true,
                next: true,
                seek: true,
            },
            message: "Connected to system media.".to_string(),
        };

        let published = runtime.publish(observed);

        assert_eq!(published.status, MediaStatus::Available);
        assert_eq!(published.playback, MediaPlayback::Playing);
        assert_eq!(published.seq, 1);
        assert_eq!(runtime.snapshot(), published);
    }

    #[test]
    fn unavailable_media_never_carries_track_or_control_data() {
        let snapshot = MediaSnapshot::unavailable("Open a supported media app.");

        assert_eq!(snapshot.status, MediaStatus::Unavailable);
        assert_eq!(snapshot.playback, MediaPlayback::Unknown);
        assert_eq!(snapshot.title, None);
        assert_eq!(snapshot.artist, None);
        assert_eq!(snapshot.controls, MediaControls::default());
    }

    #[test]
    fn controls_reject_replaced_tracks_and_sources_before_dispatch() {
        let mut observed = MediaSnapshot::loading();
        observed.status = MediaStatus::Available;
        observed.source_id = Some("player-a".into());
        observed.title = Some("Orbit".into());
        observed.controls.toggle = true;
        observed.controls.seek = true;
        observed.min_seek_ms = Some(1000);
        observed.max_seek_ms = Some(10_000);
        let expected = track_key(&observed);
        for position in [1000, 10_000] {
            assert!(
                observed
                    .validate_action(MediaAction::Seek(position), &expected)
                    .is_ok()
            );
        }
        assert!(
            observed
                .validate_action(MediaAction::Seek(999), &expected)
                .is_err()
        );
        assert!(
            observed
                .validate_action(MediaAction::Previous, &expected)
                .is_err()
        );
        observed.controls.seek = false;
        assert!(
            observed
                .validate_action(MediaAction::Seek(4000), &expected)
                .is_err()
        );
        observed.controls.seek = true;
        assert!(
            observed
                .validate_action(MediaAction::Seek(4000), &expected)
                .is_ok()
        );
        assert!(
            observed
                .validate_action(MediaAction::Seek(10_001), &expected)
                .is_err()
        );
        observed.session_revision = Some(2);
        assert!(
            observed
                .validate_action(MediaAction::Seek(4000), &expected)
                .is_err()
        );
        observed.session_revision = None;
        observed.title = Some("New orbit".into());
        assert!(
            observed
                .validate_action(MediaAction::Seek(4000), &expected)
                .is_err()
        );
        observed.title = Some("Orbit".into());
        observed.source_id = Some("player-b".into());
        assert!(
            observed
                .validate_action(MediaAction::Toggle, &expected)
                .is_err()
        );
        observed.source_id = Some("player-a".into());
        observed.status = MediaStatus::Unavailable;
        assert!(
            observed
                .validate_action(MediaAction::Toggle, &expected)
                .is_err()
        );
    }

    #[test]
    fn media_actions_reject_unknown_commands_and_missing_seek_positions() {
        assert!(MediaAction::parse("unknown", None).is_err());
        assert!(MediaAction::parse("seek", None).is_err());
        assert_eq!(
            MediaAction::parse("seek", Some(480)).unwrap(),
            MediaAction::Seek(480)
        );
    }
}
