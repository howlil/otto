use crate::notch::{
    MAX_TOP_OFFSET, hit_region_plan, needs_region_update, placement_origin, surface_size,
    surface_target, top_inset, window_size,
};
#[cfg(windows)]
use crate::windows::placement::{Silhouette, shape_for};
use std::time::{Duration, Instant};
#[cfg(not(windows))]
use tauri::{LogicalSize, PhysicalPosition};
use tauri::{State, WebviewWindow};

#[derive(serde::Serialize)]
pub struct AppliedSurface {
    placement: String,
    width: u32,
    height: u32,
    #[serde(rename = "outerWidth")]
    outer_width: Option<u32>,
    #[serde(rename = "outerHeight")]
    outer_height: Option<u32>,
    #[serde(rename = "geometryConfirmed")]
    geometry_confirmed: bool,
}

struct SurfaceRequest<'a> {
    surface: &'a str,
    shape: &'a str,
    top_offset: u32,
    content_height: Option<u32>,
    defer_shrink: bool,
}

fn validate_surface(request: &SurfaceRequest<'_>) -> Result<(), String> {
    if surface_size(request.surface).is_none() {
        return Err("Invalid notch surface.".to_string());
    }
    if request.top_offset > MAX_TOP_OFFSET {
        return Err(format!(
            "Top offset must be between 0 and {MAX_TOP_OFFSET} px."
        ));
    }
    #[cfg(windows)]
    Silhouette::parse(request.shape)?;
    Ok(())
}

struct Frame {
    origin_x: i32,
    origin_y: i32,
    bounds_width: u32,
    bounds_height: u32,
    scale: f64,
    last: Option<(i32, i32, i32, i32, bool)>,
    region: Option<(String, i32, i32)>,
}

impl Frame {
    fn confirmed_size(
        window: &WebviewWindow,
        expected_width: u32,
        expected_height: u32,
    ) -> Result<(u32, u32), String> {
        let deadline = Instant::now() + Duration::from_millis(120);
        loop {
            let observed = window
                .outer_size()
                .map_err(|_| "Notch size unavailable.".to_string())?;
            if observed.width == expected_width && observed.height == expected_height {
                return Ok((observed.width, observed.height));
            }
            if Instant::now() >= deadline {
                return Err(format!(
                    "Notch resize was not confirmed: expected {}x{}, observed {}x{}.",
                    expected_width, expected_height, observed.width, observed.height
                ));
            }
            std::thread::sleep(Duration::from_millis(2));
        }
    }

    fn capture(window: &WebviewWindow) -> Result<Self, String> {
        let monitor = window
            .current_monitor()
            .map_err(|_| "Monitor unavailable.".to_string())?
            .ok_or("Monitor unavailable.")?;
        let scale = window.scale_factor().map_err(|_| "DPI unavailable.")?;
        let bounds = monitor.size();
        let origin = monitor.position();
        Ok(Self {
            origin_x: origin.x,
            origin_y: origin.y,
            bounds_width: bounds.width,
            bounds_height: bounds.height,
            scale,
            last: None,
            region: None,
        })
    }

    fn apply(
        &mut self,
        window: &WebviewWindow,
        width: f64,
        height: f64,
        top_offset: u32,
        shape: &str,
        region: Option<(f64, f64)>,
    ) -> Result<(u32, u32), String> {
        if let Some((region_width, region_height)) = region {
            let physical_region = (
                (region_width * self.scale).round() as i32,
                (region_height * self.scale).round() as i32,
            );
            if needs_region_update(self.region.as_ref(), shape, physical_region) {
                let silhouette = Silhouette::parse(shape)?;
                crate::windows::placement::apply_region_at(
                    window,
                    shape_for(silhouette, f64::from(physical_region.1), self.scale),
                    f64::from(physical_region.0),
                    f64::from(physical_region.1),
                    0,
                    0,
                )
                .map_err(|_| "Windows could not shape the notch window.".to_string())?;
                self.region = Some((shape.to_string(), physical_region.0, physical_region.1));
            }
        }
        let physical_width = (width * self.scale).round() as i32;
        let physical_height = (height * self.scale).round() as i32;
        let attached = shape == "attached";
        let (x, y) = placement_origin(
            self.origin_x,
            self.origin_y,
            self.bounds_width,
            physical_width,
            self.scale,
            top_inset(attached, top_offset),
        );
        let geometry = (physical_width, physical_height, x, y, attached);
        if self.last == Some(geometry) {
            return Self::confirmed_size(window, physical_width as u32, physical_height as u32);
        }
        #[cfg(windows)]
        {
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                SWP_NOACTIVATE, SWP_NOZORDER, SetWindowPos,
            };
            let hwnd = window
                .hwnd()
                .map_err(|_| "Cannot access the notch window.".to_string())?;

            let ok = unsafe {
                SetWindowPos(
                    hwnd.0 as _,
                    std::ptr::null_mut(),
                    x,
                    y,
                    physical_width,
                    physical_height,
                    SWP_NOACTIVATE | SWP_NOZORDER,
                )
            };
            if ok == 0 {
                return Err(format!(
                    "Cannot position or resize the notch: {}",
                    std::io::Error::last_os_error()
                ));
            }
        }
        #[cfg(not(windows))]
        {
            window
                .set_size(LogicalSize::new(width, height))
                .map_err(|_| "Cannot resize the notch.".to_string())?;
            window
                .set_position(PhysicalPosition::new(x, y))
                .map_err(|_| "Cannot position the notch.".to_string())?;
        }
        self.last = Some(geometry);
        Self::confirmed_size(window, physical_width as u32, physical_height as u32)
    }
}

fn resize_notch(
    window: &WebviewWindow,
    request: &SurfaceRequest<'_>,
) -> Result<(u32, u32, u32, u32), String> {
    let mut frame = Frame::capture(window)?;
    let scale = frame.scale;
    let top_offset = request.top_offset;
    let attached = request.shape == "attached";
    let available_height = ((f64::from(frame.bounds_height) / scale).floor() as u32)
        .saturating_sub(top_inset(attached, top_offset).saturating_add(16));
    let (body_width, height, target_width, target_height) = surface_target(
        request.surface,
        request.shape,
        request.content_height,
        available_height,
    )
    .ok_or("Invalid notch surface.")?;
    let current = window.outer_size().map_err(|_| "Notch size unavailable.")?;
    let (window_width, window_height) = window_size(
        (
            f64::from(current.width) / scale,
            f64::from(current.height) / scale,
        ),
        (target_width, target_height),
        request.defer_shrink,
    );
    let region = (!request.defer_shrink).then_some((target_width, target_height));
    let (outer_width, outer_height) = frame.apply(
        window,
        window_width,
        window_height,
        top_offset,
        request.shape,
        region,
    )?;
    Ok((body_width, height, outer_width, outer_height))
}

#[tauri::command]
pub fn notch_measure_surface(
    window: WebviewWindow,
    surface: String,
    shape: String,
    top_offset: u32,
    content_height: Option<u32>,
) -> Result<AppliedSurface, String> {
    let request = SurfaceRequest {
        surface: &surface,
        shape: &shape,
        top_offset,
        content_height,
        defer_shrink: false,
    };
    validate_surface(&request)?;
    let frame = Frame::capture(&window)?;
    let attached = shape == "attached";
    let available_height = ((f64::from(frame.bounds_height) / frame.scale).floor() as u32)
        .saturating_sub(top_inset(attached, top_offset).saturating_add(16));
    let (width, height, _, _) = surface_target(
        request.surface,
        request.shape,
        request.content_height,
        available_height,
    )
    .ok_or("Invalid notch surface.")?;
    let placement = if shape == "attached" {
        "attached"
    } else {
        "floating"
    };
    Ok(AppliedSurface {
        placement: placement.to_string(),
        width,
        height,
        outer_width: None,
        outer_height: None,
        geometry_confirmed: false,
    })
}

#[tauri::command]
pub fn notch_set_hit_region(
    window: WebviewWindow,
    width: u32,
    height: u32,
    shape: String,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let silhouette = Silhouette::parse(&shape)?;
        let scale = window
            .scale_factor()
            .map_err(|_| "DPI unavailable.".to_string())?;
        let outer = window
            .outer_size()
            .map_err(|_| "Notch size unavailable.".to_string())?;
        let current = (outer.width as i32, outer.height as i32);
        let target = (
            (f64::from(width) * scale).round() as i32,
            (f64::from(height) * scale).round() as i32,
        );
        crate::windows::placement::apply_hit_region(
            &window,
            silhouette,
            scale,
            current,
            target,
            hit_region_plan(current, target),
        )
        .map_err(|_| "Windows could not update the notch hit region.".to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = (window, width, height, shape);
        Ok(())
    }
}

#[derive(Default)]
pub struct NotchPlacementState {
    applied: std::sync::Mutex<String>,
}

#[tauri::command]
pub fn notch_set_surface(
    window: WebviewWindow,
    placement: State<'_, NotchPlacementState>,
    surface: String,
    shape: String,
    top_offset: u32,
    content_height: Option<u32>,
    defer_shrink: bool,
) -> Result<AppliedSurface, String> {
    let request = SurfaceRequest {
        surface: &surface,
        shape: &shape,
        top_offset,
        content_height,
        defer_shrink,
    };
    validate_surface(&request)?;
    let (width, height, outer_width, outer_height) = resize_notch(&window, &request)?;
    let applied = if shape == "attached" {
        "attached"
    } else {
        "floating"
    };
    *placement
        .applied
        .lock()
        .map_err(|_| "Notch placement state is unavailable.".to_string())? = applied.to_string();
    Ok(AppliedSurface {
        placement: applied.to_string(),
        width,
        height,
        outer_width: Some(outer_width),
        outer_height: Some(outer_height),
        geometry_confirmed: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn surface_request<'a>(
        surface: &'a str,
        shape: &'a str,
        top_offset: u32,
    ) -> SurfaceRequest<'a> {
        SurfaceRequest {
            surface,
            shape,
            top_offset,
            content_height: None,
            defer_shrink: false,
        }
    }

    #[test]
    fn surface_requests_reject_unknown_surfaces_shapes_and_offsets() {
        assert!(validate_surface(&surface_request("home", "capsule", 20)).is_ok());
        assert!(validate_surface(&surface_request("agentFull", "card", 0)).is_ok());
        assert!(validate_surface(&surface_request("home", "attached", 64)).is_ok());
        assert!(validate_surface(&surface_request("unknown", "capsule", 20)).is_err());
        assert!(validate_surface(&surface_request("home", "island", 20)).is_err());
        assert!(validate_surface(&surface_request("home", "attached", 65)).is_err());
    }
}
