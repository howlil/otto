use super::notch_window::{
    observed_bounds, pick_monitor, position_host, reveal, show_startup_error_and_exit,
};
#[cfg(windows)]
use crate::shell::notch::shifted_region;
use crate::shell::notch::{
    HostAnchor, PositionPx, RectPx, RegionOrder, RegionPx, host_bounds, resolve_floating_host,
    resolve_surface_rect, surface_probe_center,
};
use crate::shell::otto_os::circle_slot;
use crate::shell::sizing::{DisplayGeometry, content_top, drawable_monitor, resolve_layouts};
use std::sync::Mutex;
use tauri::{State, WebviewWindow};

fn default_true() -> bool {
    true
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotchHost {
    revision: u32,
    placement: String,
    width: f64,
    height: f64,
    pub(super) scale: f64,
    layouts: std::collections::BTreeMap<&'static str, (u32, u32)>,
    display: DisplayGeometry,
    content_top: u32,
    pub(super) otto_os: bool,
    pub(super) anchor: HostAnchor,
    pub(super) position: PositionPx,
}

const OTTO_OS_CIRCLE_PX: u32 = 40;

#[derive(Clone, Copy, PartialEq)]
pub(super) struct Track {
    pub(super) host_width: u32,
    pub(super) monitor: RectPx,
    pub(super) scale: f64,
    pub(super) diameter: u32,
}

#[derive(Clone)]
pub(super) struct ConfiguredHost {
    pub(super) view: NotchHost,
    pub(super) bounds: RectPx,
    pub(super) track: Option<Track>,
    client_id: String,
    attempt: u32,
}

#[derive(Default)]
pub(super) struct HostState {
    pub(super) host: Option<ConfiguredHost>,
    order: RegionOrder,
    pub(super) region: Option<RegionPx>,
    pub(super) revealed: bool,
    #[cfg(windows)]
    pub(super) last_signal: Option<std::time::Instant>,
    #[cfg(windows)]
    pub(super) follow_spring: crate::shell::otto_os::SpringFollow,
    #[cfg(windows)]
    pub(super) last_follow: Option<std::time::Instant>,
}

#[derive(Default)]
pub struct NotchHostState(pub(super) Mutex<HostState>);

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostRequest {
    placement: String,
    top_offset: u32,
    position: Option<PositionPx>,
    width: u32,
    height: u32,
    client_id: String,
    attempt: u32,
    #[serde(default = "default_true")]
    dock_with_otto_os: bool,
    #[serde(default)]
    compact_circle: bool,
    #[serde(default)]
    surface_rect: Option<RectPx>,
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
        position,
        width,
        height,
        client_id,
        attempt,
        dock_with_otto_os,
        compact_circle,
        surface_rect,
    } = request;
    if !matches!(placement.as_str(), "floating" | "attached")
        || client_id.is_empty()
        || client_id.len() > 128
    {
        return Err("Invalid notch placement.".into());
    }
    let probe_point = position
        .map(|pos| surface_probe_center(pos, surface_rect, (width, height), compact_circle));
    let monitor = pick_monitor(window, probe_point)?;
    let scale = monitor.scale_factor();
    let size = monitor.size();
    let origin = monitor.position();
    let work = monitor.work_area();
    #[cfg(target_os = "macos")]
    let display = crate::platform::macos::display::measure(window).unwrap_or_else(|_| {
        crate::shell::sizing::approximate_geometry(f64::from(work.position.y - origin.y) / scale)
    });
    #[cfg(not(target_os = "macos"))]
    let display = DisplayGeometry::default();
    let otto_os_present = crate::ipc::otto_os::active();
    let otto_os = placement == "floating" && otto_os_present && dock_with_otto_os;
    let mut drawable = drawable_monitor(
        &display,
        placement == "attached",
        RectPx {
            x: origin.x,
            y: origin.y,
            width: size.width,
            height: size.height,
        },
        scale,
    );
    let host_width = ((f64::from(width) * scale).round() as u32)
        .min(size.width)
        .max(1);
    let monitor_px = drawable;
    let slot = otto_os
        .then(crate::ipc::otto_os::notch)
        .flatten()
        .and_then(|notch| circle_slot(notch, host_width, monitor_px, scale));
    let track = slot.filter(|_| position.is_none()).map(|slot| Track {
        host_width,
        monitor: monitor_px,
        scale,
        diameter: slot.diameter,
    });
    if otto_os_present && placement == "floating" && slot.is_none() {
        let reserved = (work.position.y - drawable.y).max(0);
        drawable.y += reserved;
        drawable.height = drawable.height.saturating_sub(reserved as u32);
    }
    let mut layouts = resolve_layouts(&display, placement == "attached");
    if otto_os {
        let circle = slot.map_or(OTTO_OS_CIRCLE_PX, |slot| slot.diameter);
        layouts.insert("agentCompact", (circle, circle));
        layouts.insert("agentCompactCircle", (circle, circle));
    }
    let (bounds, anchor) = if placement == "floating"
        && let Some(pos) = position
    {
        let work_rect = RectPx {
            x: work.position.x,
            y: work.position.y,
            width: work.size.width,
            height: work.size.height,
        };
        let compact_key = if compact_circle || otto_os {
            "agentCompactCircle"
        } else {
            "agentCompact"
        };
        let compact = layouts.get(compact_key).copied().unwrap_or((228, 40));
        let default_h = ((f64::from(height) * scale).round() as u32)
            .min(work.size.height)
            .max(1);
        let screen_surface = resolve_surface_rect(
            pos,
            surface_rect,
            host_width.min(work.size.width).max(1),
            default_h,
            compact,
            scale,
        );
        resolve_floating_host(work_rect, scale, (width, height), screen_surface)?
    } else {
        let target_position = position.or(slot.map(|slot| slot.position));
        let rect = host_bounds(
            drawable,
            i64::from(work.position.y) + i64::from(work.size.height),
            scale,
            (width, height),
            placement == "attached",
            top_offset,
            target_position,
        )?;
        (rect, HostAnchor::default())
    };
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
        && host.view.otto_os == otto_os
        && host.view.anchor == anchor
        && host.view.layouts == layouts
    {
        return Ok(host.view.clone());
    }
    let glides = track.is_some()
        && state.revealed
        && previous.width == bounds.width
        && previous.height == bounds.height;
    if previous != bounds && !glides {
        #[cfg(windows)]
        if state.revealed
            && (previous.x != bounds.x || previous.y != bounds.y)
            && let Some(current_region) = state.region
            && let Some(shifted) = shifted_region(current_region, previous, bounds)
        {
            let _ = crate::platform::windows::region::apply_reported_region(
                window,
                &shifted,
                Some(&current_region),
                false,
            );
        }
        if let Err(error) = position_host(window, bounds) {
            let _ = position_host(window, previous);
            return Err(error);
        }
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
        layouts,
        otto_os,
        anchor,
        position: PositionPx::anchored(bounds, anchor),
        display,
        placement,
        width: f64::from(bounds.width) / scale,
        height: f64::from(bounds.height) / scale,
        scale,
    };
    #[cfg(windows)]
    if !glides {
        state.follow_spring.reset();
        state.last_follow = None;
    }
    state.host = Some(ConfiguredHost {
        view: host.clone(),
        bounds,
        track,
        client_id,
        attempt,
    });
    Ok(host)
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
    let morph = region.morph
        && state
            .region
            .as_ref()
            .is_some_and(|last| last.host_revision == region.host_revision);
    let region = RegionPx { morph, ..region };
    let unchanged = state
        .region
        .as_ref()
        .is_some_and(|last| last.host_revision == region.host_revision && region.same_shape(last));
    #[cfg(windows)]
    if !unchanged {
        crate::platform::windows::region::apply_reported_region(
            window,
            &region,
            state.region.as_ref(),
            !morph
                && state
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
        crate::platform::windows::region::apply_reported_region(
            window,
            &region,
            Some(&region),
            true,
        )
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
    show_startup_error_and_exit(window, error);
}
