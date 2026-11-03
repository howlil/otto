use super::{Observer, sleep_while, spawn};
use crate::os_events::{EventSink, Observation, PeripheralKind};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use windows::{
    Devices::{
        Bluetooth::{BluetoothConnectionStatus, BluetoothDevice},
        Enumeration::{DeviceInformation, DeviceInformationUpdate, DeviceWatcher},
    },
    Foundation::TypedEventHandler,
    Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize, RoUninitialize},
    core::{HSTRING, IInspectable},
};

const IDLE_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Clone)]
struct Tracked {
    name: Option<String>,
    kind: PeripheralKind,
}

pub fn start(sink: Arc<dyn EventSink>) -> Option<Box<dyn Observer>> {
    spawn("otto-os-bluetooth", sink, run)
}

fn run(sink: Arc<dyn EventSink>, stop: &AtomicBool) {
    unsafe {
        if RoInitialize(RO_INIT_MULTITHREADED).is_err() {
            return;
        }
    }
    let selector = BluetoothDevice::GetDeviceSelectorFromConnectionStatus(
        BluetoothConnectionStatus::Connected,
    );
    let Ok(selector) = selector else {
        unsafe { RoUninitialize() };
        return;
    };
    let Ok(watcher) = DeviceInformation::CreateWatcherAqsFilter(&selector) else {
        unsafe { RoUninitialize() };
        return;
    };
    let connected = Arc::new(Mutex::new(HashMap::<String, Tracked>::new()));
    let enumerated = Arc::new(AtomicBool::new(false));

    let added = TypedEventHandler::<DeviceWatcher, DeviceInformation>::new({
        let sink = sink.clone();
        let connected = connected.clone();
        let enumerated = enumerated.clone();
        move |_, info| {
            if let Some(info) = info.as_ref() {
                let id = text(info.Id());
                let name = text(info.Name());
                let tracked = Tracked {
                    kind: classify(&name),
                    name: (!name.is_empty()).then_some(name),
                };
                let known = connected
                    .lock()
                    .unwrap()
                    .insert(id, tracked.clone())
                    .is_some();
                if enumerated.load(Ordering::SeqCst) && !known {
                    sink.observe(Observation::Peripheral {
                        connected: true,
                        kind: tracked.kind,
                        name: tracked.name,
                    });
                }
            }
            Ok(())
        }
    });
    let removed = TypedEventHandler::<DeviceWatcher, DeviceInformationUpdate>::new({
        let sink = sink.clone();
        let connected = connected.clone();
        let enumerated = enumerated.clone();
        move |_, info| {
            if let Some(info) = info.as_ref()
                && let Some(tracked) = connected.lock().unwrap().remove(&text(info.Id()))
                && enumerated.load(Ordering::SeqCst)
            {
                sink.observe(Observation::Peripheral {
                    connected: false,
                    kind: tracked.kind,
                    name: tracked.name,
                });
            }
            Ok(())
        }
    });
    let completed = TypedEventHandler::<DeviceWatcher, IInspectable>::new({
        let enumerated = enumerated.clone();
        move |_, _| {
            enumerated.store(true, Ordering::SeqCst);
            Ok(())
        }
    });

    let Ok(added_token) = watcher.Added(&added) else {
        unsafe { RoUninitialize() };
        return;
    };
    let Ok(removed_token) = watcher.Removed(&removed) else {
        let _ = watcher.RemoveAdded(added_token);
        unsafe { RoUninitialize() };
        return;
    };
    let Ok(completed_token) = watcher.EnumerationCompleted(&completed) else {
        let _ = watcher.RemoveAdded(added_token);
        let _ = watcher.RemoveRemoved(removed_token);
        unsafe { RoUninitialize() };
        return;
    };
    if watcher.Start().is_err() {
        let _ = watcher.RemoveAdded(added_token);
        let _ = watcher.RemoveRemoved(removed_token);
        let _ = watcher.RemoveEnumerationCompleted(completed_token);
        unsafe { RoUninitialize() };
        return;
    }

    let started = std::time::Instant::now();
    while !stop.load(Ordering::SeqCst) {
        sleep_while(stop, IDLE_INTERVAL);
        if !enumerated.load(Ordering::SeqCst) && started.elapsed() > Duration::from_secs(2) {
            enumerated.store(true, Ordering::SeqCst);
        }
    }

    let _ = watcher.Stop();
    let _ = watcher.RemoveAdded(added_token);
    let _ = watcher.RemoveRemoved(removed_token);
    let _ = watcher.RemoveEnumerationCompleted(completed_token);
    drop(watcher);
    drop(added);
    drop(removed);
    drop(completed);
    drop(selector);
    unsafe { RoUninitialize() };
}

fn text(value: windows::core::Result<HSTRING>) -> String {
    value.map(|value| value.to_string()).unwrap_or_default()
}

fn classify(name: &str) -> PeripheralKind {
    let name = name.to_lowercase();
    if [
        "headphone",
        "headset",
        "audio",
        "speaker",
        "buds",
        "sound",
        "earbud",
    ]
    .iter()
    .any(|word| name.contains(word))
    {
        return PeripheralKind::Audio;
    }
    if [
        "mouse",
        "keyboard",
        "gamepad",
        "controller",
        "trackpad",
        "pen",
    ]
    .iter()
    .any(|word| name.contains(word))
    {
        return PeripheralKind::Input;
    }
    PeripheralKind::Unknown
}
