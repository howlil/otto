pub mod battery;
pub mod brightness;
pub mod devices;
pub mod volume;
pub mod wifi;

use crate::os_events::EventSink;
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU32, Ordering},
    },
    thread::{self, JoinHandle},
    time::Duration,
};
use windows::Win32::{
    Foundation::{LPARAM, WPARAM},
    UI::WindowsAndMessaging::{PostThreadMessageW, WM_QUIT},
};

pub trait Observer: Send + Sync {
    fn stop(&self);
}

pub struct Observers {
    observers: Vec<Box<dyn Observer>>,
}

impl Observers {
    pub fn stop(&self) {
        for observer in &self.observers {
            observer.stop();
        }
    }
}

impl Drop for Observers {
    fn drop(&mut self) {
        self.stop();
    }
}

pub struct ThreadObserver {
    stop: Arc<AtomicBool>,
    thread_id: Option<Arc<AtomicU32>>,
    handle: Mutex<Option<JoinHandle<()>>>,
}

impl ThreadObserver {
    pub fn new(stop: Arc<AtomicBool>, handle: JoinHandle<()>) -> Self {
        Self {
            stop,
            thread_id: None,
            handle: Mutex::new(Some(handle)),
        }
    }

    pub fn with_thread_id(mut self, thread_id: Arc<AtomicU32>) -> Self {
        self.thread_id = Some(thread_id);
        self
    }
}

impl Observer for ThreadObserver {
    fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(thread_id) = &self.thread_id {
            let id = thread_id.load(Ordering::SeqCst);
            if id != 0 {
                unsafe {
                    let _ = PostThreadMessageW(id, WM_QUIT, WPARAM(0), LPARAM(0));
                }
            }
        }
        if let Some(handle) = self.handle.lock().unwrap().take() {
            let _ = handle.join();
        }
    }
}

pub fn start_all(sink: Arc<dyn EventSink>) -> Observers {
    let mut observers: Vec<Box<dyn Observer>> = Vec::new();
    if let Some(observer) = volume::start(sink.clone()) {
        observers.push(observer);
    }
    if let Some(observer) = battery::start(sink.clone()) {
        observers.push(observer);
    }
    if let Some(observer) = brightness::start(sink.clone()) {
        observers.push(observer);
    }
    if let Some(observer) = wifi::start(sink.clone()) {
        observers.push(observer);
    }
    if let Some(observer) = devices::start(sink) {
        observers.push(observer);
    }
    Observers { observers }
}

pub(crate) fn spawn(
    name: &str,
    sink: Arc<dyn EventSink>,
    run: fn(Arc<dyn EventSink>, &AtomicBool),
) -> Option<Box<dyn Observer>> {
    let stop = Arc::new(AtomicBool::new(false));
    let stop_thread = stop.clone();
    let handle = thread::Builder::new()
        .name(name.to_string())
        .spawn(move || run(sink, &stop_thread))
        .ok()?;
    Some(Box::new(ThreadObserver::new(stop, handle)))
}

pub(crate) fn sleep_while(stop: &AtomicBool, duration: Duration) {
    let step = Duration::from_millis(50);
    let mut remaining = duration;
    while !stop.load(Ordering::SeqCst) && remaining > Duration::ZERO {
        let slice = remaining.min(step);
        thread::sleep(slice);
        remaining = remaining.saturating_sub(slice);
    }
}
