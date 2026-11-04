mod model;
mod policy;

#[cfg(test)]
pub use model::OsEventClass;
pub use model::{EventSink, Observation, OsEventView, PeripheralKind};
pub use policy::Hub;

use std::{
    collections::HashMap,
    sync::{
        Mutex,
        atomic::AtomicBool,
        atomic::{AtomicU64, Ordering},
    },
};
use tauri::ipc::Channel;

pub struct OsEventRuntime {
    hub: Mutex<Hub>,
    subscribers: Mutex<HashMap<u64, Channel<OsEventView>>>,
    next_subscription: AtomicU64,
    enabled: AtomicBool,
}

impl Default for OsEventRuntime {
    fn default() -> Self {
        Self {
            hub: Mutex::new(Hub::default()),
            subscribers: Mutex::new(HashMap::new()),
            next_subscription: AtomicU64::new(0),
            enabled: AtomicBool::new(true),
        }
    }
}

impl OsEventRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn subscribe(&self, channel: Channel<OsEventView>) -> u64 {
        let id = self.next_subscription.fetch_add(1, Ordering::SeqCst) + 1;
        let mut hub = self.hub.lock().unwrap();
        let current = hub.current();
        let mut subscribers = self.subscribers.lock().unwrap();
        if self.enabled.load(Ordering::SeqCst)
            && let Some(view) = current
        {
            let _ = channel.send(view);
        }
        subscribers.insert(id, channel);
        id
    }

    pub fn unsubscribe(&self, subscription_id: u64) {
        self.subscribers.lock().unwrap().remove(&subscription_id);
    }

    pub fn set_enabled(&self, enabled: bool) {
        let mut hub = self.hub.lock().unwrap();
        self.enabled.store(enabled, Ordering::SeqCst);
        if !enabled {
            hub.clear_current();
        }
    }
}

impl EventSink for OsEventRuntime {
    fn observe(&self, observation: Observation) {
        if !self.enabled.load(Ordering::SeqCst) {
            return;
        }
        let mut hub = self.hub.lock().unwrap();
        if !self.enabled.load(Ordering::SeqCst) {
            return;
        }
        let Some(view) = hub.observe_now(observation) else {
            return;
        };
        let subscribers = self.subscribers.lock().unwrap();
        for channel in subscribers.values() {
            let _ = channel.send(view.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_runtime_drops_observations_and_clears_active_event() {
        let runtime = OsEventRuntime::new();
        runtime.observe(Observation::Volume {
            percent: 40,
            muted: false,
        });
        assert!(runtime.hub.lock().unwrap().current().is_some());

        runtime.set_enabled(false);
        runtime.observe(Observation::Volume {
            percent: 50,
            muted: false,
        });
        assert!(runtime.hub.lock().unwrap().current().is_none());

        runtime.set_enabled(true);
        runtime.observe(Observation::Volume {
            percent: 60,
            muted: false,
        });
        assert!(runtime.hub.lock().unwrap().current().is_some());
    }
}
