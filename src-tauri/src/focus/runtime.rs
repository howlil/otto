use super::{TimerDurations, TimerPhase, TimerSnapshot, model::FocusTimerState};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};
use tauri::ipc::Channel;
use tokio::sync::Notify;

pub(crate) struct FocusTimerRuntime {
    state: Mutex<FocusTimerState>,
    subscribers: Mutex<HashMap<u64, Channel<TimerSnapshot>>>,
    next_subscription: AtomicU64,
    worker_started: AtomicBool,
    wake: Notify,
}

impl FocusTimerRuntime {
    pub(crate) fn new() -> Self {
        Self {
            state: Mutex::new(FocusTimerState::default()),
            subscribers: Mutex::new(HashMap::new()),
            next_subscription: AtomicU64::new(0),
            worker_started: AtomicBool::new(false),
            wake: Notify::new(),
        }
    }

    pub(crate) fn start_worker(self: &Arc<Self>) {
        if self.worker_started.swap(true, Ordering::AcqRel) {
            return;
        }
        let runtime = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            runtime.run_worker().await;
        });
    }

    pub(crate) fn snapshot(&self) -> TimerSnapshot {
        let mut state = self.state.lock().unwrap();
        let revision = state.revision();
        state.refresh(Instant::now());
        let snapshot = state.snapshot();
        if snapshot.revision != revision {
            self.publish(snapshot.clone());
        }
        snapshot
    }

    pub(crate) fn subscribe(&self, channel: Channel<TimerSnapshot>) -> u64 {
        let subscription_id = self.next_subscription.fetch_add(1, Ordering::SeqCst) + 1;
        let mut state = self.state.lock().unwrap();
        let revision = state.revision();
        state.refresh(Instant::now());
        let snapshot = state.snapshot();
        let mut subscribers = self.subscribers.lock().unwrap();
        if snapshot.revision != revision {
            for subscriber in subscribers.values() {
                let _ = subscriber.send(snapshot.clone());
            }
        }
        let _ = channel.send(snapshot);
        subscribers.insert(subscription_id, channel);
        subscription_id
    }

    pub(crate) fn unsubscribe(&self, subscription_id: u64) {
        self.subscribers.lock().unwrap().remove(&subscription_id);
    }

    pub(crate) fn start(&self) -> Result<TimerSnapshot, String> {
        self.change(|state, now| state.start(now))
    }

    pub(crate) fn pause(&self) -> Result<TimerSnapshot, String> {
        self.change(|state, now| state.pause(now))
    }

    pub(crate) fn reset(&self) -> Result<TimerSnapshot, String> {
        self.change(|state, now| Ok(state.reset(now)))
    }

    pub(crate) fn configure(&self, durations: TimerDurations) -> Result<TimerSnapshot, String> {
        self.change(|state, now| state.configure(durations, now))
    }

    pub(crate) fn select_phase(
        &self,
        phase: TimerPhase,
        discard_active: bool,
    ) -> Result<TimerSnapshot, String> {
        self.change(|state, now| state.select_phase(phase, discard_active, now))
    }

    pub(crate) fn start_next(&self) -> Result<TimerSnapshot, String> {
        self.change(|state, now| state.start_next(now))
    }

    fn change(
        &self,
        operation: impl FnOnce(&mut FocusTimerState, Instant) -> Result<bool, String>,
    ) -> Result<TimerSnapshot, String> {
        let (result, snapshot, changed) = {
            let mut state = self.state.lock().unwrap();
            let revision = state.revision();
            let result = operation(&mut state, Instant::now());
            let snapshot = state.snapshot();
            let changed = snapshot.revision != revision;
            if changed {
                self.publish(snapshot.clone());
            }
            (result, snapshot, changed)
        };
        if changed && result.is_ok() {
            self.wake.notify_one();
        }
        result.map(|_| snapshot)
    }

    fn publish(&self, snapshot: TimerSnapshot) {
        let subscribers = self.subscribers.lock().unwrap();
        for channel in subscribers.values() {
            let _ = channel.send(snapshot.clone());
        }
    }

    async fn run_worker(self: Arc<Self>) {
        loop {
            let delay = {
                let now = Instant::now();
                let mut state = self.state.lock().unwrap();
                let revision = state.revision();
                state.refresh(now);
                let snapshot = state.snapshot();
                if snapshot.revision != revision {
                    self.publish(snapshot);
                }
                state.next_wake_delay(now)
            };
            match delay {
                Some(delay) => {
                    let delay = if delay.is_zero() {
                        Duration::from_millis(1)
                    } else {
                        delay
                    };
                    tokio::select! {
                        _ = tokio::time::sleep(delay) => {}
                        _ = self.wake.notified() => {}
                    }
                }
                None => self.wake.notified().await,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use tauri::ipc::InvokeResponseBody;

    #[test]
    fn subscription_receives_ordered_snapshots_for_timer_controls() {
        let runtime = FocusTimerRuntime::new();
        let received = Arc::new(Mutex::new(Vec::<Value>::new()));
        let received_by_channel = Arc::clone(&received);
        let channel = Channel::new(move |body| {
            let InvokeResponseBody::Json(json) = body else {
                panic!("timer snapshots must use JSON IPC bodies");
            };
            received_by_channel
                .lock()
                .unwrap()
                .push(serde_json::from_str(&json).unwrap());
            Ok(())
        });

        let subscription_id = runtime.subscribe(channel);
        runtime.start().unwrap();
        runtime.pause().unwrap();
        runtime.unsubscribe(subscription_id);

        let received = received.lock().unwrap();
        let statuses: Vec<_> = received
            .iter()
            .map(|snapshot| snapshot["status"].as_str().unwrap())
            .collect();
        let revisions: Vec<_> = received
            .iter()
            .map(|snapshot| snapshot["revision"].as_u64().unwrap())
            .collect();

        assert_eq!(statuses, ["ready", "running", "paused"]);
        assert!(revisions.windows(2).all(|pair| pair[0] < pair[1]));
    }
}
