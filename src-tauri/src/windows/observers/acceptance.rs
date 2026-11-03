use super::start_all;
use crate::os_events::{EventSink, Hub, Observation, OsEventClass, OsEventView};
use std::{
    process::Command,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

#[derive(Default)]
struct Recorder(Mutex<Vec<Observation>>);

impl EventSink for Recorder {
    fn observe(&self, observation: Observation) {
        self.0.lock().unwrap().push(observation);
    }
}

fn signal(action: &str, extra: &[&str]) -> Option<serde_json::Value> {
    let script = format!(
        "{}/../scripts/os-events-signal.ps1",
        env!("CARGO_MANIFEST_DIR")
    );
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            &script,
            "-Action",
            action,
        ])
        .args(extra)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(text.trim()).ok()
}

fn wait_for<F>(sink: &Arc<Recorder>, timeout: Duration, matched: F) -> bool
where
    F: Fn(&Observation) -> bool,
{
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if sink.0.lock().unwrap().iter().any(&matched) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

fn attended() -> bool {
    std::env::var("OTTO_NATIVE_EVENTS").as_deref() == Ok("1")
}

#[test]
#[ignore = "native signal acceptance; run with OTTO_NATIVE_EVENTS=1"]
fn native_volume_and_brightness_reach_the_event_sink() {
    if !attended() {
        return;
    }
    let probe = signal("probe", &[]).expect("signal probe failed");
    let sink = Arc::new(Recorder::default());
    let observers = start_all(sink.clone());
    std::thread::sleep(Duration::from_millis(1_000));

    if !probe["audio"].as_bool().unwrap_or(false) {
        eprintln!("skip: no active audio endpoint");
    }
    if probe["brightness"].as_bool().unwrap_or(false) == false {
        eprintln!("skip: no brightness source");
    }
    if probe["audio"].as_bool().unwrap_or(false) {
        assert!(
            signal("volume-mute", &[]).is_some(),
            "volume trigger failed"
        );
        let seen = wait_for(&sink, Duration::from_secs(6), |observation| {
            matches!(observation, Observation::Volume { .. })
        });
        let _ = signal("volume-mute", &[]);
        assert!(
            seen,
            "Core Audio volume callback did not reach the event sink"
        );
    }

    if probe["brightness"].as_bool().unwrap_or(false) {
        let toggle = signal("brightness-toggle", &[]).expect("brightness trigger failed");
        let previous = toggle["previous"].as_i64();
        let seen = wait_for(&sink, Duration::from_secs(16), |observation| {
            matches!(observation, Observation::Brightness { .. })
        });
        if let Some(previous) = previous {
            let level = previous.to_string();
            let _ = signal("brightness-set", &["-Level", &level]);
        }
        assert!(seen, "brightness change did not reach the event sink");
    }

    observers.stop();

    let observations = sink.0.lock().unwrap().clone();
    let views: Vec<OsEventView> = observations
        .into_iter()
        .filter_map(|observation| Hub::default().observe(0, observation))
        .collect();
    assert!(
        views
            .iter()
            .any(|view| view.class() == OsEventClass::Volume)
            || !probe["audio"].as_bool().unwrap_or(false),
        "volume observation did not become a volume event"
    );
    assert!(
        views
            .iter()
            .any(|view| view.class() == OsEventClass::Brightness)
            || !probe["brightness"].as_bool().unwrap_or(false),
        "brightness observation did not become a brightness event"
    );
}

#[test]
#[ignore = "native Wi-Fi acceptance; run with OTTO_NATIVE_EVENTS_NETWORK=1"]
fn native_wifi_transition_reaches_the_event_sink() {
    if std::env::var("OTTO_NATIVE_EVENTS_NETWORK").as_deref() != Ok("1") {
        eprintln!("skip: set OTTO_NATIVE_EVENTS_NETWORK=1 to allow a real Wi-Fi disconnect");
        return;
    }
    let probe = signal("probe", &[]).expect("signal probe failed");
    if !probe["wifi"]["connected"].as_bool().unwrap_or(false) {
        eprintln!("skip: no connected Wi-Fi interface");
        return;
    }
    let profile = probe["wifi"]["profile"]
        .as_str()
        .or_else(|| probe["wifi"]["ssid"].as_str())
        .unwrap_or_default()
        .to_string();
    assert!(!profile.is_empty(), "connected Wi-Fi has no profile");

    let sink = Arc::new(Recorder::default());
    let observers = start_all(sink.clone());
    std::thread::sleep(Duration::from_millis(1_500));

    let disconnect = signal("wifi-disconnect", &[]).expect("wifi disconnect failed");
    if !disconnect["disconnected"].as_bool().unwrap_or(false) {
        observers.stop();
        return;
    }
    let offline = wait_for(&sink, Duration::from_secs(15), |observation| {
        matches!(observation, Observation::Wifi { connected: false })
    });
    let reconnect =
        signal("wifi-reconnect", &["-Profile", &profile]).expect("wifi reconnect failed");
    assert!(
        reconnect["connected"].as_bool().unwrap_or(false),
        "Wi-Fi did not reconnect; restore profile {profile} manually"
    );
    let online = wait_for(&sink, Duration::from_secs(25), |observation| {
        matches!(observation, Observation::Wifi { connected: true })
    });
    observers.stop();
    assert!(offline, "Wi-Fi disconnect did not reach the event sink");
    assert!(online, "Wi-Fi reconnect did not reach the event sink");
}
