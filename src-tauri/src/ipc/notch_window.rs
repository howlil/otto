use crate::shell::notch::{PositionPx, RectPx, rect_distance_sq};
use tauri::{Manager, Monitor, WebviewWindow};
#[cfg(not(windows))]
use tauri::{PhysicalPosition, PhysicalSize};

pub(super) fn observed_bounds(window: &WebviewWindow) -> Result<RectPx, String> {
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    Ok(RectPx {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

pub(super) fn position_host(window: &WebviewWindow, bounds: RectPx) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SWP_NOACTIVATE, SWP_NOZORDER, SetWindowPos,
        };
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        let ok = unsafe {
            SetWindowPos(
                hwnd.0 as _,
                std::ptr::null_mut(),
                bounds.x,
                bounds.y,
                bounds.width as i32,
                bounds.height as i32,
                SWP_NOACTIVATE | SWP_NOZORDER,
            )
        };
        if ok == 0 {
            return Err("Windows could not position Otto's host.".into());
        }
    }
    #[cfg(not(windows))]
    {
        window
            .set_size(PhysicalSize::new(bounds.width, bounds.height))
            .map_err(|error| error.to_string())?;
        window
            .set_position(PhysicalPosition::new(bounds.x, bounds.y))
            .map_err(|error| error.to_string())?;
    }
    if observed_bounds(window)? != bounds {
        return Err("Windows did not retain Otto's host geometry.".into());
    }
    Ok(())
}

fn monitor_rect(monitor: &Monitor) -> RectPx {
    let origin = monitor.position();
    let size = monitor.size();
    RectPx {
        x: origin.x,
        y: origin.y,
        width: size.width,
        height: size.height,
    }
}

pub(super) fn pick_monitor(
    window: &WebviewWindow,
    point: Option<(i64, i64)>,
) -> Result<Monitor, String> {
    if let Some((x, y)) = point
        && let Ok(monitors) = window.available_monitors()
        && let Some(best) = monitors
            .into_iter()
            .min_by_key(|monitor| rect_distance_sq(monitor_rect(monitor), x, y))
    {
        return Ok(best);
    }
    window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Monitor unavailable.".into())
}

pub(super) fn reveal(window: &WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{SW_SHOWNOACTIVATE, ShowWindow};
        crate::platform::windows::overlay::ensure_tool_style(window)
            .map_err(|error| error.to_string())?;
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        unsafe {
            ShowWindow(hwnd.0 as _, SW_SHOWNOACTIVATE);
        }
        crate::platform::windows::overlay::ensure_tool_style(window)
            .map_err(|error| error.to_string())?;
    }
    #[cfg(not(windows))]
    window.show().map_err(|error| error.to_string())?;
    Ok(())
}

pub(super) fn show_startup_error_and_exit(window: &WebviewWindow, error: &str) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MessageBoxW};
        let message: Vec<u16> = format!(
            "Otto could not prepare its window.\n\n{error}\n\nClose this message, then reopen Otto to retry."
        )
        .encode_utf16()
        .chain(Some(0))
        .collect();
        let title: Vec<u16> = "Otto window unavailable"
            .encode_utf16()
            .chain(Some(0))
            .collect();
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                message.as_ptr(),
                title.as_ptr(),
                MB_OK | MB_ICONERROR,
            );
        }
    }
    #[cfg(not(windows))]
    eprintln!("Otto window unavailable: {error}");
    window.app_handle().exit(1);
}

#[tauri::command]
pub async fn notch_finish_drag(window: WebviewWindow) -> Result<PositionPx, String> {
    #[cfg(windows)]
    {
        let _ = tauri::async_runtime::spawn_blocking(|| {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
            std::thread::sleep(std::time::Duration::from_millis(24));
            while crate::platform::windows::otto_os::pointer_pressed()
                && std::time::Instant::now() < deadline
            {
                std::thread::sleep(std::time::Duration::from_millis(16));
            }
        })
        .await;
    }
    let position = window.outer_position().map_err(|error| error.to_string())?;
    Ok(PositionPx::plain(position.x, position.y))
}
