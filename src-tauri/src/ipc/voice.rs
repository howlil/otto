use crate::voice::{VoiceInputDevice, VoiceRecordOptions, VoiceRuntime, VoiceSnapshot};
use tauri::{AppHandle, Emitter, Manager, State};

fn emit_state(app: &AppHandle, snapshot: &VoiceSnapshot) {
    let _ = app.emit("otto-voice-state", snapshot);
}

#[tauri::command]
pub fn voice_status(voice: State<'_, VoiceRuntime>) -> VoiceSnapshot {
    voice.snapshot()
}

#[tauri::command]
pub fn voice_list_devices(voice: State<'_, VoiceRuntime>) -> Vec<VoiceInputDevice> {
    voice.list_devices()
}

#[tauri::command]
pub async fn voice_shortcut(app: AppHandle, shortcut: Option<String>) -> Result<String, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let service = app.state::<crate::platform::windows::voice_shortcut::VoiceShortcut>();
            if let Some(value) = shortcut {
                service.configure(value)?;
            }
            Ok(service.current())
        })
        .await
        .map_err(|_| "Voice shortcut service failed.".to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (app, shortcut);
        Err("Global voice shortcuts require Windows.".into())
    }
}

#[tauri::command]
pub async fn voice_download_model(
    app: AppHandle,
    voice: State<'_, VoiceRuntime>,
    model_id: String,
) -> Result<VoiceSnapshot, String> {
    let handle = app.clone();
    voice
        .download_model(&model_id, move |snapshot| {
            emit_state(&handle, &snapshot);
        })
        .await
}

#[tauri::command]
pub fn voice_cancel_download(app: AppHandle, voice: State<'_, VoiceRuntime>) -> VoiceSnapshot {
    let snapshot = voice.cancel_download();
    emit_state(&app, &snapshot);
    snapshot
}

#[tauri::command]
pub fn voice_delete_model(
    app: AppHandle,
    voice: State<'_, VoiceRuntime>,
    model_id: String,
) -> Result<VoiceSnapshot, String> {
    let snapshot = voice.delete_model(&model_id)?;
    emit_state(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub fn voice_start_recording(
    app: AppHandle,
    voice: State<'_, VoiceRuntime>,
    options: VoiceRecordOptions,
) -> Result<VoiceSnapshot, String> {
    let level_app = app.clone();
    let auto_stop_app = app.clone();
    let voice_clone = voice.inner().clone();
    let snapshot = voice.start_recording(
        options,
        move |level| {
            let _ = level_app.emit("otto-voice-level", level);
        },
        move || {
            let emit_app = auto_stop_app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = voice_clone
                    .stop_and_transcribe(|snap| {
                        emit_state(&emit_app, &snap);
                    })
                    .await;
            });
        },
    )?;
    emit_state(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub async fn voice_stop_recording(
    app: AppHandle,
    voice: State<'_, VoiceRuntime>,
) -> Result<VoiceSnapshot, String> {
    let emit_app = app.clone();
    voice
        .stop_and_transcribe(move |snapshot| {
            emit_state(&emit_app, &snapshot);
        })
        .await
}

#[tauri::command]
pub fn voice_cancel(app: AppHandle, voice: State<'_, VoiceRuntime>) -> VoiceSnapshot {
    let snapshot = voice.cancel();
    emit_state(&app, &snapshot);
    snapshot
}
