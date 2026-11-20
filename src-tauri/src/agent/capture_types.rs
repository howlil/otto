use std::path::PathBuf;
#[cfg(windows)]
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
#[cfg(windows)]
use std::time::Duration;
#[cfg(windows)]
use tokio::time::timeout;

#[cfg(windows)]
pub(crate) struct CaptureReservation(Arc<AtomicBool>);

#[cfg(windows)]
impl CaptureReservation {
    pub(crate) fn acquire(in_flight: Arc<AtomicBool>) -> Result<Self, String> {
        in_flight
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "Screen capture is already in progress.".to_string())?;
        Ok(Self(in_flight))
    }
}

#[cfg(windows)]
impl Drop for CaptureReservation {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[cfg(windows)]
pub enum CapturedImageOutcome {
    Captured(CapturedImage),
    Cancelled,
}

#[cfg(windows)]
pub(crate) async fn capture_with_deadline<F>(
    reservation: &Arc<CaptureReservation>,
    deadline: Duration,
    capture: F,
) -> Result<CapturedImageOutcome, String>
where
    F: FnOnce() -> Result<CapturedImageOutcome, String> + Send + 'static,
{
    let worker_reservation = Arc::clone(reservation);
    let worker = tokio::task::spawn_blocking(move || {
        let result = capture();
        drop(worker_reservation);
        result
    });
    match timeout(deadline, worker).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("Windows capture failed.".into()),
        Err(_) => Err(
            "Window capture timed out. Focus a responsive window and retry. If capture stays busy, restart Otto."
                .into(),
        ),
    }
}

#[cfg(windows)]
pub(crate) async fn capture_text_with_deadline<F>(
    reservation: &Arc<CaptureReservation>,
    deadline: Duration,
    capture: F,
) -> Result<String, String>
where
    F: FnOnce() -> Result<String, String> + Send + 'static,
{
    let worker_reservation = Arc::clone(reservation);
    let worker = tokio::task::spawn_blocking(move || {
        let result = capture();
        drop(worker_reservation);
        result
    });
    match timeout(deadline, worker).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("Windows selected-text capture failed.".into()),
        Err(_) => Err(
            "Selected-text capture timed out. Focus a responsive application and retry. If capture stays busy, restart Otto."
                .into(),
        ),
    }
}

pub struct CapturedImage(PathBuf);

impl CapturedImage {
    pub fn new(path: PathBuf) -> Self {
        Self(path)
    }

    pub fn path(&self) -> &std::path::Path {
        &self.0
    }
}

impl Drop for CapturedImage {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}
