use crate::notch::{RectPx, RegionOrder, RegionPx, host_bounds};
use crate::notch_sizing::{DisplayGeometry, content_top, drawable_monitor, resolve_layouts};
use std::sync::Mutex;
use tauri::{Manager, State, WebviewWindow};
#[cfg(not(windows))]
use tauri::{PhysicalPosition, PhysicalSize};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotchHost {
    revision: u32,
    placement: String,
    width: f64,
    height: f64,
    scale: f64,
    layouts: std::collections::BTreeMap<&'static str, (u32, u32)>,
    display: DisplayGeometry,
    content_top: u32,
}

#[derive(Clone)]
struct ConfiguredHost {
    view: NotchHost,
    bounds: RectPx,
    client_id: String,
    attempt: u32,
}

#[derive(Default)]
struct HostState {
    host: Option<ConfiguredHost>,
    order: RegionOrder,
    region: Option<RegionPx>,
    revealed: bool,
}

#[derive(Default)]
pub struct NotchHostState(Mutex<HostState>);

fn observed_bounds(window: &WebviewWindow) -> Result<RectPx, String> {
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    Ok(RectPx {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

fn position_host(window: &WebviewWindow, bounds: RectPx) -> Result<(), String> {
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

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostRequest {
    placement: String,
    top_offset: u32,
    width: u32,
    height: u32,
    client_id: String,
    attempt: u32,
}

#[tauri::command]
pub fn notch_configure_host(
    window: WebviewWindow,
    state: State<'_, NotchHostState>,
    request: HostRequest,
) -> Result<NotchHost, String> {
    let result = configure_host(&window, &state, request);
    if let Err(error) = &result {
        report_startup_failure(&window, &state, error);
    }
    result
}

fn configure_host(
    window: &WebviewWindow,
    state: &NotchHostState,
    request: HostRequest,
) -> Result<NotchHost, String> {
    let HostRequest {
        placement,
        top_offset,
        width,
        height,
        client_id,
        attempt,
    } = request;
    if !matches!(placement.as_str(), "floating" | "attached")
        || client_id.is_empty()
        || client_id.len() > 128
    {
        return Err("Invalid notch placement.".into());
    }
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .ok_or("Monitor unavailable.")?;
    let scale = monitor.scale_factor();
    let size = monitor.size();
    let origin = monitor.position();
    let work = monitor.work_area();
    #[cfg(target_os = "macos")]
    let display = crate::macos_display::measure(window).unwrap_or_else(|_| {
        crate::notch_sizing::approximate_geometry(f64::from(work.position.y - origin.y) / scale)
    });
    #[cfg(not(target_os = "macos"))]
    let display = DisplayGeometry::default();
    let bounds = host_bounds(
        drawable_monitor(
            &display,
            placement == "attached",
            RectPx {
                x: origin.x,
                y: origin.y,
                width: size.width,
                height: size.height,
            },
            scale,
        ),
        i64::from(work.position.y) + i64::from(work.size.height),
        scale,
        (width, height),
        placement == "attached",
        top_offset,
    )?;
    let mut state = state
        .0
        .lock()
        .map_err(|_| "Notch host state unavailable.")?;
    let previous = observed_bounds(window)?;
    if let Some(host) = &state.host
        && host.bounds == bounds
        && previous == bounds
        && host.client_id == client_id
        && host.attempt == attempt
        && host.view.scale == scale
        && host.view.placement == placement
        && host.view.display == display
    {
        return Ok(host.view.clone());
    }
    if previous != bounds
        && let Err(error) = position_host(window, bounds)
    {
        let _ = position_host(window, previous);
        return Err(error);
    }
    state.order.revision = state
        .order
        .revision
        .checked_add(1)
        .ok_or("Notch revision exhausted.")?;
    state.order.sequence = 0;
    let host = NotchHost {
        revision: state.order.revision,
        content_top: content_top(&display, placement == "attached"),
        layouts: resolve_layouts(&display, placement == "attached"),
        display,
        placement,
        width: f64::from(bounds.width) / scale,
        height: f64::from(bounds.height) / scale,
        scale,
    };
    state.host = Some(ConfiguredHost {
        view: host.clone(),
        bounds,
        client_id,
        attempt,
    });
    Ok(host)
}

fn reveal(window: &WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{SW_SHOWNOACTIVATE, ShowWindow};
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        unsafe {
            ShowWindow(hwnd.0 as _, SW_SHOWNOACTIVATE);
        }
        crate::windows::overlay::ensure_tool_style(window).map_err(|error| error.to_string())?;
    }
    #[cfg(not(windows))]
    window.show().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn notch_set_region(
    window: WebviewWindow,
    state: State<'_, NotchHostState>,
    region: RegionPx,
) -> Result<bool, String> {
    let result = update_region(&window, &state, region);
    if let Err(error) = &result {
        report_startup_failure(&window, &state, error);
    }
    result
}

fn update_region(
    window: &WebviewWindow,
    state: &NotchHostState,
    region: RegionPx,
) -> Result<bool, String> {
    let mut state = state
        .0
        .lock()
        .map_err(|_| "Notch host state unavailable.")?;
    if !state.order.accepts(&region) {
        return Ok(false);
    }
    let host = state
        .host
        .as_ref()
        .ok_or("Configure the notch host first.")?;
    region.validate((host.bounds.width, host.bounds.height))?;
    if (host.view.placement == "attached") != (region.shoulder > 0) {
        return Err("Notch region does not match the confirmed placement.".into());
    }
    let unchanged = state
        .region
        .as_ref()
        .is_some_and(|last| last.host_revision == region.host_revision && region.same_shape(last));
    #[cfg(windows)]
    if !unchanged {
        crate::windows::placement::apply_reported_region(
            window,
            &region,
            state.region.as_ref(),
            state
                .region
                .as_ref()
                .is_none_or(|last| last.host_revision != region.host_revision),
        )
        .map_err(|error| error.to_string())?;
    }
    #[cfg(not(windows))]
    let _ = unchanged;
    if !state.revealed {
        reveal(window)?;
        #[cfg(windows)]
        crate::windows::placement::apply_reported_region(window, &region, Some(&region), true)
            .map_err(|error| error.to_string())?;
        state.revealed = true;
    }
    state.region = Some(region);
    state.order.sequence = region.sequence;
    Ok(true)
}

fn report_startup_failure(window: &WebviewWindow, state: &NotchHostState, error: &str) {
    if state.0.lock().is_ok_and(|state| state.revealed) {
        return;
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MessageBoxW};
        let message: Vec<u16> = format!("Otto could not prepare its window.\n\n{error}\n\nClose this message, then reopen Otto to retry.").encode_utf16().chain(Some(0)).collect();
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
