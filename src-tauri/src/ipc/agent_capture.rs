use crate::agent::{AgentRuntime, StagedCaptureSnapshot};
#[cfg(windows)]
use crate::agent::{CapturedImage, CapturedImageOutcome};
#[cfg(windows)]
use std::time::Duration;
#[cfg(windows)]
use tauri::Manager;
use tauri::State;

#[cfg(windows)]
const DEFAULT_CAPTURE_DEADLINE: Duration = Duration::from_secs(12);
#[cfg(windows)]
const REGION_CAPTURE_DEADLINE: Duration = Duration::from_secs(65);
#[cfg(windows)]
const WINDOW_CAPTURE_PROMPT: &str = "Analyze the captured application window. Describe what is visible and answer any apparent question without modifying files.";
#[cfg(windows)]
const SCROLLING_CAPTURE_PROMPT: &str = "Analyze the captured scrolling window. Describe what is visible and answer any apparent question without modifying files.";
#[cfg(windows)]
const FULLSCREEN_CAPTURE_PROMPT: &str = "Analyze the captured full screen. Describe what is visible and answer any apparent question without modifying files.";
#[cfg(windows)]
const REGION_CAPTURE_PROMPT: &str = "Analyze the captured screen area. Describe what is visible and answer any apparent question without modifying files.";

#[cfg(windows)]
fn dispatch_image_with_options<F>(
    app: &tauri::AppHandle,
    deadline: Duration,
    prompt: &'static str,
    capture: F,
) -> Result<(), String>
where
    F: FnOnce() -> Result<CapturedImageOutcome, String> + Send + 'static,
{
    let runtime = app.state::<AgentRuntime>();
    let (request_id, reservation) = runtime.begin_capture()?;
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let runtime = handle.state::<AgentRuntime>();
        if let Err(reason) = runtime
            .capture_hotkey(request_id, reservation, deadline, prompt, capture)
            .await
        {
            runtime.capture_error_for(request_id, &reason);
        }
    });
    Ok(())
}

#[cfg(windows)]
pub(crate) fn dispatch_image<F>(app: &tauri::AppHandle, capture: F) -> Result<(), String>
where
    F: FnOnce() -> Result<CapturedImage, String> + Send + 'static,
{
    dispatch_image_with_options(
        app,
        DEFAULT_CAPTURE_DEADLINE,
        WINDOW_CAPTURE_PROMPT,
        move || capture().map(CapturedImageOutcome::Captured),
    )
}

#[cfg(windows)]
pub(crate) fn dispatch_scrolling_image<F>(app: &tauri::AppHandle, capture: F) -> Result<(), String>
where
    F: FnOnce() -> Result<CapturedImage, String> + Send + 'static,
{
    dispatch_image_with_options(
        app,
        DEFAULT_CAPTURE_DEADLINE,
        SCROLLING_CAPTURE_PROMPT,
        move || capture().map(CapturedImageOutcome::Captured),
    )
}

#[cfg(windows)]
pub(crate) fn dispatch_fullscreen_image<F>(app: &tauri::AppHandle, capture: F) -> Result<(), String>
where
    F: FnOnce() -> Result<CapturedImage, String> + Send + 'static,
{
    dispatch_image_with_options(
        app,
        DEFAULT_CAPTURE_DEADLINE,
        FULLSCREEN_CAPTURE_PROMPT,
        move || capture().map(CapturedImageOutcome::Captured),
    )
}

#[cfg(windows)]
pub(crate) fn dispatch_region_image<F>(app: &tauri::AppHandle, capture: F) -> Result<(), String>
where
    F: FnOnce() -> Result<CapturedImageOutcome, String> + Send + 'static,
{
    dispatch_image_with_options(app, REGION_CAPTURE_DEADLINE, REGION_CAPTURE_PROMPT, capture)
}

#[cfg(windows)]
pub(crate) fn dispatch_text<F>(app: &tauri::AppHandle, capture: F) -> Result<(), String>
where
    F: FnOnce() -> Result<String, String> + Send + 'static,
{
    let runtime = app.state::<AgentRuntime>();
    let (request_id, reservation) = runtime.begin_capture()?;
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let runtime = handle.state::<AgentRuntime>();
        if let Err(reason) = runtime
            .selected_text_hotkey(request_id, reservation, capture)
            .await
        {
            runtime.capture_error_for(request_id, &reason);
        }
    });
    Ok(())
}

#[cfg(windows)]
pub(crate) fn report_error(app: &tauri::AppHandle, reason: &str) {
    app.state::<AgentRuntime>().capture_error(reason);
}

#[tauri::command]
pub fn agent_configure_capture_shortcut(
    app: tauri::AppHandle,
    shortcut: String,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        app.state::<crate::platform::windows::capture::CaptureHotkeys>()
            .configure(&shortcut)?;
        app.state::<AgentRuntime>().clear_capture_error();
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, shortcut);
        Err("Screen capture shortcuts require Windows.".into())
    }
}

#[tauri::command]
pub fn agent_configure_capture_source(app: tauri::AppHandle, source: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        app.state::<crate::platform::windows::capture::CaptureHotkeys>()
            .configure_source(&source)?;
        app.state::<AgentRuntime>().clear_capture_error();
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, source);
        Err("Screen capture requires Windows.".into())
    }
}

#[tauri::command]
pub fn agent_configure_text_capture_shortcut(
    app: tauri::AppHandle,
    shortcut: String,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        app.state::<crate::platform::windows::capture::CaptureHotkeys>()
            .configure_text_shortcut(&shortcut)?;
        app.state::<AgentRuntime>().clear_capture_error();
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, shortcut);
        Err("Screen capture shortcuts require Windows.".into())
    }
}

#[tauri::command]
pub fn agent_configure_capture_auto_send(
    runtime: State<'_, AgentRuntime>,
    auto_send: bool,
) -> Result<(), String> {
    runtime.set_capture_auto_send(auto_send);
    Ok(())
}

#[tauri::command]
pub fn agent_stage_image(
    runtime: State<'_, AgentRuntime>,
    png_base64: String,
    label: Option<String>,
) -> Result<StagedCaptureSnapshot, String> {
    runtime.stage_image_base64(&png_base64, label)
}

#[tauri::command]
pub fn agent_clear_staged_capture(runtime: State<'_, AgentRuntime>) {
    runtime.clear_staged_capture();
}

#[tauri::command]
pub async fn agent_capture_now(
    app: tauri::AppHandle,
    source: Option<String>,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let hotkeys = app.state::<crate::platform::windows::capture::CaptureHotkeys>();
            match source {
                Some(source) => hotkeys.trigger_source(&source),
                None => hotkeys.trigger(),
            }
        })
        .await
        .map_err(|_| "Capture request could not be dispatched.".to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (app, source);
        Err("Screen capture requires Windows.".into())
    }
}

#[tauri::command]
pub async fn agent_insert_text(text: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || {
            crate::platform::windows::capture::insert_text_at_caret(&text)
        })
        .await
        .map_err(|_| "Text insertion could not be dispatched.".to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = text;
        Err("Text insertion requires Windows.".into())
    }
}

#[tauri::command]
pub fn agent_capture_target_title() -> Result<String, String> {
    #[cfg(windows)]
    {
        crate::platform::windows::capture::capture_target_title()
    }
    #[cfg(not(windows))]
    {
        Err("Window target lookup requires Windows.".into())
    }
}
