use crate::media::{
    MediaAction, MediaControls, MediaPlayback, MediaRuntime, MediaSnapshot, MediaStatus,
};
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError, Sender},
    },
    thread::{self, JoinHandle},
    time::Duration,
};
use windows::{
    Foundation::{TimeSpan, TypedEventHandler},
    Media::Control::{
        CurrentSessionChangedEventArgs, GlobalSystemMediaTransportControlsSession,
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus, MediaPropertiesChangedEventArgs,
        PlaybackInfoChangedEventArgs, SessionsChangedEventArgs, TimelinePropertiesChangedEventArgs,
    },
    Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize, RoUninitialize},
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(2);
const TICKS_PER_MILLISECOND: u64 = 10_000;

enum Request {
    Refresh(Option<Sender<Result<MediaSnapshot, String>>>),
    EventRefresh,
    Control {
        action: MediaAction,
        expected_track: String,
        reply: Sender<Result<MediaSnapshot, String>>,
    },
    Stop,
}

pub struct MediaController {
    sender: Sender<Request>,
    handle: Mutex<Option<JoinHandle<()>>>,
}

impl MediaController {
    pub fn start(runtime: Arc<MediaRuntime>) -> Self {
        let (sender, receiver) = mpsc::channel();
        let events = sender.clone();
        let event_pending = Arc::new(AtomicBool::new(false));
        let worker_pending = event_pending.clone();
        let worker_runtime = runtime.clone();
        let handle = thread::Builder::new()
            .name("otto-system-media".to_string())
            .spawn(move || run(worker_runtime, receiver, events, worker_pending))
            .ok();
        if handle.is_none() {
            runtime.publish(MediaSnapshot::unsupported(
                "System media worker could not start.",
            ));
        }
        Self {
            sender,
            handle: Mutex::new(handle),
        }
    }

    pub fn refresh(&self) -> Result<MediaSnapshot, String> {
        self.request(|reply| Request::Refresh(Some(reply)))
    }

    pub fn control(
        &self,
        action: MediaAction,
        expected_track: String,
    ) -> Result<MediaSnapshot, String> {
        self.request(|reply| Request::Control {
            action,
            expected_track,
            reply,
        })
    }

    fn request(
        &self,
        request: impl FnOnce(Sender<Result<MediaSnapshot, String>>) -> Request,
    ) -> Result<MediaSnapshot, String> {
        let (reply, response) = mpsc::channel();
        self.sender
            .send(request(reply))
            .map_err(|_| "System media worker is unavailable.".to_string())?;
        response
            .recv_timeout(REQUEST_TIMEOUT)
            .map_err(|error| match error {
                RecvTimeoutError::Timeout => "System media did not respond in time.".to_string(),
                RecvTimeoutError::Disconnected => "System media worker is unavailable.".to_string(),
            })?
    }
}

impl Drop for MediaController {
    fn drop(&mut self) {
        let _ = self.sender.send(Request::Stop);
        if let Some(handle) = self.handle.lock().unwrap().take() {
            let _ = handle.join();
        }
    }
}

struct ManagerBinding {
    manager: GlobalSystemMediaTransportControlsSessionManager,
    current_session: i64,
    sessions: i64,
}

struct SessionBinding {
    session: GlobalSystemMediaTransportControlsSession,
    timeline: i64,
    playback: i64,
    media: i64,
}

struct Worker {
    runtime: Arc<MediaRuntime>,
    events: Sender<Request>,
    event_pending: Arc<AtomicBool>,
    manager: Option<ManagerBinding>,
    session: Option<SessionBinding>,
    session_revision: u64,
}

fn run(
    runtime: Arc<MediaRuntime>,
    receiver: Receiver<Request>,
    events: Sender<Request>,
    event_pending: Arc<AtomicBool>,
) {
    match unsafe { RoInitialize(RO_INIT_MULTITHREADED) } {
        Ok(()) => {}
        Err(error) => {
            runtime.publish(MediaSnapshot::unsupported(format!(
                "System media is unavailable: {error}"
            )));
            respond_without_media(runtime, receiver);
            return;
        }
    };
    let mut worker = Worker {
        runtime,
        events,
        event_pending,
        manager: None,
        session: None,
        session_revision: 0,
    };
    worker.refresh();
    while let Ok(request) = receiver.recv() {
        match request {
            Request::Refresh(reply) => {
                let snapshot = worker.refresh();
                if let Some(reply) = reply {
                    let _ = reply.send(Ok(snapshot));
                }
            }
            Request::EventRefresh => {
                worker.event_pending.store(false, Ordering::Release);
                worker.refresh();
            }
            Request::Control {
                action,
                expected_track,
                reply,
            } => {
                let _ = reply.send(worker.control(action, &expected_track));
            }
            Request::Stop => break,
        }
    }
    worker.clear_session();
    worker.clear_manager();
    unsafe { RoUninitialize() };
}

fn respond_without_media(runtime: Arc<MediaRuntime>, receiver: Receiver<Request>) {
    while let Ok(request) = receiver.recv() {
        match request {
            Request::Refresh(Some(reply)) => {
                let _ = reply.send(Ok(runtime.snapshot()));
            }
            Request::Control { reply, .. } => {
                let _ = reply.send(Err("System media worker is unavailable.".to_string()));
            }
            Request::Refresh(None) => {}
            Request::EventRefresh => {}
            Request::Stop => break,
        }
    }
}

impl Worker {
    fn refresh(&mut self) -> MediaSnapshot {
        if let Err(error) = self.ensure_manager() {
            return self.runtime.publish(MediaSnapshot::unsupported(format!(
                "System media is unavailable: {error}"
            )));
        }
        let session = self
            .manager
            .as_ref()
            .and_then(|binding| binding.manager.GetCurrentSession().ok());
        let Some(session) = session else {
            self.clear_session();
            return self.runtime.publish(MediaSnapshot::unavailable(
                "Open a supported media app to show playback here.",
            ));
        };
        if self.session_changed(&session)
            && let Err(error) = self.bind_session(session)
        {
            return self.runtime.publish(MediaSnapshot::unavailable(format!(
                "System media session could not be observed: {error}"
            )));
        }
        match self.observe() {
            Ok(snapshot) => self.runtime.publish(snapshot),
            Err(error) => self.runtime.publish(MediaSnapshot::unavailable(format!(
                "System media session could not be read: {error}"
            ))),
        }
    }

    fn control(
        &mut self,
        action: MediaAction,
        expected_track: &str,
    ) -> Result<MediaSnapshot, String> {
        let snapshot = self.refresh();
        if snapshot.status != MediaStatus::Available {
            return Err("No active media session supports that action.".to_string());
        }
        snapshot.validate_action(action, expected_track)?;
        let session = self
            .session
            .as_ref()
            .map(|binding| binding.session.clone())
            .ok_or_else(|| "No active media session.".to_string())?;
        let accepted = match action {
            MediaAction::Toggle => session.TryTogglePlayPauseAsync(),
            MediaAction::Previous => session.TrySkipPreviousAsync(),
            MediaAction::Next => session.TrySkipNextAsync(),
            MediaAction::Seek(position_ms) => session.TryChangePlaybackPositionAsync(
                i64::try_from(
                    position_ms
                        .checked_mul(TICKS_PER_MILLISECOND)
                        .ok_or_else(|| "Playback position is too large.".to_string())?,
                )
                .map_err(|_| "Playback position is too large.".to_string())?,
            ),
        }
        .map_err(|error| error.to_string())?
        .join()
        .map_err(|error| error.to_string())?;
        if !accepted {
            return Err("The media session did not accept that action.".to_string());
        }
        Ok(self.refresh())
    }

    fn ensure_manager(&mut self) -> Result<(), String> {
        if self.manager.is_some() {
            return Ok(());
        }
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|error| error.to_string())?
            .join()
            .map_err(|error| error.to_string())?;
        let current_events = self.events.clone();
        let current_pending = self.event_pending.clone();
        let current_session = manager
            .CurrentSessionChanged(&TypedEventHandler::<
                GlobalSystemMediaTransportControlsSessionManager,
                CurrentSessionChangedEventArgs,
            >::new(move |_, _| {
                queue_event_refresh(&current_events, &current_pending);
                Ok(())
            }))
            .map_err(|error| error.to_string())?;
        let session_events = self.events.clone();
        let sessions_pending = self.event_pending.clone();
        let sessions = manager
            .SessionsChanged(&TypedEventHandler::<
                GlobalSystemMediaTransportControlsSessionManager,
                SessionsChangedEventArgs,
            >::new(move |_, _| {
                queue_event_refresh(&session_events, &sessions_pending);
                Ok(())
            }))
            .map_err(|error| error.to_string())?;
        self.manager = Some(ManagerBinding {
            manager,
            current_session,
            sessions,
        });
        Ok(())
    }

    fn session_changed(&self, session: &GlobalSystemMediaTransportControlsSession) -> bool {
        self.session
            .as_ref()
            .is_none_or(|current| current.session != *session)
    }

    fn bind_session(
        &mut self,
        session: GlobalSystemMediaTransportControlsSession,
    ) -> Result<(), String> {
        self.clear_session();
        let timeline_events = self.events.clone();
        let timeline_pending = self.event_pending.clone();
        let timeline = session
            .TimelinePropertiesChanged(&TypedEventHandler::<
                GlobalSystemMediaTransportControlsSession,
                TimelinePropertiesChangedEventArgs,
            >::new(move |_, _| {
                queue_event_refresh(&timeline_events, &timeline_pending);
                Ok(())
            }))
            .map_err(|error| error.to_string())?;
        let playback_events = self.events.clone();
        let playback_pending = self.event_pending.clone();
        let playback = session
            .PlaybackInfoChanged(&TypedEventHandler::<
                GlobalSystemMediaTransportControlsSession,
                PlaybackInfoChangedEventArgs,
            >::new(move |_, _| {
                queue_event_refresh(&playback_events, &playback_pending);
                Ok(())
            }))
            .map_err(|error| error.to_string())?;
        let media_events = self.events.clone();
        let media_pending = self.event_pending.clone();
        let media = session
            .MediaPropertiesChanged(&TypedEventHandler::<
                GlobalSystemMediaTransportControlsSession,
                MediaPropertiesChangedEventArgs,
            >::new(move |_, _| {
                queue_event_refresh(&media_events, &media_pending);
                Ok(())
            }))
            .map_err(|error| error.to_string())?;
        self.session_revision = self.session_revision.saturating_add(1);
        self.session = Some(SessionBinding {
            session,
            timeline,
            playback,
            media,
        });
        Ok(())
    }

    fn observe(&self) -> Result<MediaSnapshot, String> {
        let session = self
            .session
            .as_ref()
            .map(|binding| &binding.session)
            .ok_or_else(|| "No active media session.".to_string())?;
        let playback = session
            .GetPlaybackInfo()
            .map_err(|error| error.to_string())?;
        let controls = playback
            .Controls()
            .map(|controls| MediaControls {
                toggle: controls.IsPlayPauseToggleEnabled().unwrap_or(false),
                previous: controls.IsPreviousEnabled().unwrap_or(false),
                next: controls.IsNextEnabled().unwrap_or(false),
                seek: controls.IsPlaybackPositionEnabled().unwrap_or(false),
            })
            .unwrap_or_default();
        let properties = session
            .TryGetMediaPropertiesAsync()
            .and_then(|operation| operation.join())
            .ok();
        let title = properties
            .as_ref()
            .and_then(|properties| properties.Title().ok())
            .and_then(non_empty);
        let artist = properties
            .as_ref()
            .and_then(|properties| properties.Artist().ok())
            .and_then(non_empty);
        let timeline = session.GetTimelineProperties().ok();
        let start = timeline
            .as_ref()
            .and_then(|timeline| timeline.StartTime().ok())
            .and_then(milliseconds);
        let end = timeline
            .as_ref()
            .and_then(|timeline| timeline.EndTime().ok())
            .and_then(milliseconds);
        let position = timeline
            .as_ref()
            .and_then(|timeline| timeline.Position().ok())
            .and_then(milliseconds);
        let minimum = timeline
            .as_ref()
            .and_then(|timeline| timeline.MinSeekTime().ok())
            .and_then(milliseconds);
        let maximum = timeline
            .as_ref()
            .and_then(|timeline| timeline.MaxSeekTime().ok())
            .and_then(milliseconds);
        Ok(MediaSnapshot {
            seq: 0,
            status: MediaStatus::Available,
            playback: playback_state(playback.PlaybackStatus().ok()),
            title,
            artist,
            album: properties
                .as_ref()
                .and_then(|p| p.AlbumTitle().ok())
                .and_then(non_empty),
            source_id: session.SourceAppUserModelId().ok().and_then(non_empty),
            session_revision: Some(self.session_revision),
            observed_at_ms: timeline
                .as_ref()
                .and_then(|t| t.LastUpdatedTime().ok())
                .and_then(|time| {
                    u64::try_from(time.UniversalTime / 10_000 - 11_644_473_600_000).ok()
                }),
            playback_rate: playback
                .PlaybackRate()
                .ok()
                .and_then(|rate| rate.Value().ok()),
            artwork_data_url: properties
                .as_ref()
                .and_then(super::media_artwork::read_artwork),
            position_ms: position,
            duration_ms: start
                .zip(end)
                .and_then(|(start, end)| end.checked_sub(start)),
            min_seek_ms: minimum,
            max_seek_ms: maximum,
            controls,
            message: "Connected to system media.".to_string(),
        })
    }

    fn clear_session(&mut self) {
        if let Some(binding) = self.session.take() {
            let _ = binding
                .session
                .RemoveTimelinePropertiesChanged(binding.timeline);
            let _ = binding.session.RemovePlaybackInfoChanged(binding.playback);
            let _ = binding.session.RemoveMediaPropertiesChanged(binding.media);
        }
    }

    fn clear_manager(&mut self) {
        if let Some(binding) = self.manager.take() {
            let _ = binding
                .manager
                .RemoveCurrentSessionChanged(binding.current_session);
            let _ = binding.manager.RemoveSessionsChanged(binding.sessions);
        }
    }
}

fn non_empty(value: windows_core::HSTRING) -> Option<String> {
    let value = value.to_string();
    (!value.trim().is_empty()).then_some(value)
}

fn milliseconds(value: TimeSpan) -> Option<u64> {
    u64::try_from(value.Duration)
        .ok()
        .map(|ticks| ticks / TICKS_PER_MILLISECOND)
}

fn playback_state(
    status: Option<GlobalSystemMediaTransportControlsSessionPlaybackStatus>,
) -> MediaPlayback {
    match status {
        Some(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing) => {
            MediaPlayback::Playing
        }
        Some(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused) => {
            MediaPlayback::Paused
        }
        Some(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Stopped) => {
            MediaPlayback::Stopped
        }
        _ => MediaPlayback::Unknown,
    }
}

fn queue_event_refresh(sender: &Sender<Request>, pending: &Arc<AtomicBool>) {
    if pending
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_ok()
        && sender.send(Request::EventRefresh).is_err()
    {
        pending.store(false, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::{Arc, mpsc},
        thread,
    };

    #[test]
    fn unavailable_worker_rejects_controls() {
        let runtime = Arc::new(MediaRuntime::new());
        runtime.publish(MediaSnapshot::unsupported("System media is unavailable."));
        let (sender, receiver) = mpsc::channel();
        let worker_runtime = runtime.clone();
        let worker = thread::spawn(move || respond_without_media(worker_runtime, receiver));
        let (reply, response) = mpsc::channel();

        sender
            .send(Request::Control {
                action: MediaAction::Toggle,
                expected_track: String::new(),
                reply,
            })
            .unwrap();

        assert!(response.recv_timeout(REQUEST_TIMEOUT).unwrap().is_err());
        sender.send(Request::Stop).unwrap();
        worker.join().unwrap();
    }
}
