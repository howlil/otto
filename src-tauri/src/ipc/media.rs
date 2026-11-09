use crate::lyrics::{LyricsResult, LyricsRuntime};
use crate::media::{MediaAction, MediaRuntime, MediaSnapshot};
use std::sync::Arc;
use tauri::{State, ipc::Channel};

#[tauri::command]
pub fn media_set_online_lyrics(runtime: State<'_, LyricsRuntime>, enabled: bool) {
    runtime.set_enabled(enabled);
}

#[tauri::command]
pub async fn media_lyrics(
    runtime: State<'_, LyricsRuntime>,
    media: State<'_, Arc<MediaRuntime>>,
    refresh: bool,
) -> Result<LyricsResult, String> {
    runtime.lookup(&media, refresh).await
}

#[tauri::command]
pub fn media_snapshot(runtime: State<'_, Arc<MediaRuntime>>) -> MediaSnapshot {
    runtime.snapshot()
}

#[tauri::command]
pub fn media_subscribe(
    runtime: State<'_, Arc<MediaRuntime>>,
    on_event: Channel<MediaSnapshot>,
) -> u64 {
    runtime.subscribe(on_event)
}

#[tauri::command]
pub fn media_unsubscribe(runtime: State<'_, Arc<MediaRuntime>>, subscription_id: u64) {
    runtime.unsubscribe(subscription_id);
}

#[cfg(windows)]
#[tauri::command]
pub fn media_refresh(
    controller: State<'_, crate::windows::media::MediaController>,
) -> Result<MediaSnapshot, String> {
    controller.refresh()
}

#[cfg(not(windows))]
#[tauri::command]
pub fn media_refresh(runtime: State<'_, Arc<MediaRuntime>>) -> MediaSnapshot {
    runtime.publish(MediaSnapshot::unsupported(
        "System media is available in Otto on Windows.",
    ))
}

#[cfg(windows)]
#[tauri::command]
pub fn media_control(
    controller: State<'_, crate::windows::media::MediaController>,
    command: String,
    position_ms: Option<u64>,
) -> Result<MediaSnapshot, String> {
    controller.control(MediaAction::parse(&command, position_ms)?)
}

#[cfg(not(windows))]
#[tauri::command]
pub fn media_control(
    runtime: State<'_, Arc<MediaRuntime>>,
    command: String,
    position_ms: Option<u64>,
) -> Result<MediaSnapshot, String> {
    let _ = MediaAction::parse(&command, position_ms)?;
    Ok(runtime.publish(MediaSnapshot::unsupported(
        "System media is available in Otto on Windows.",
    )))
}
