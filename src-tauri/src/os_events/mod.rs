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
        atomic::{AtomicU64, Ordering},
    },
};
use tauri::ipc::Channel;

#[derive(Default)]
pub struct OsEventRuntime {
    hub: Mutex<Hub>,
    subscribers: Mutex<HashMap<u64, Channel<OsEventView>>>,
    next_subscription: AtomicU64,
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
        if let Some(view) = current {
            let _ = channel.send(view);
        }
        subscribers.insert(id, channel);
        id
    }

    pub fn unsubscribe(&self, subscription_id: u64) {
        self.subscribers.lock().unwrap().remove(&subscription_id);
    }
}

impl EventSink for OsEventRuntime {
    fn observe(&self, observation: Observation) {
        let mut hub = self.hub.lock().unwrap();
        let Some(view) = hub.observe_now(observation) else {
            return;
        };
        let subscribers = self.subscribers.lock().unwrap();
        for channel in subscribers.values() {
            let _ = channel.send(view.clone());
        }
    }
}
