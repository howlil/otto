use crate::notch_sizing::{DisplayGeometry, approximate_geometry, measured_geometry};
use objc2::{MainThreadMarker, runtime::NSObjectProtocol, sel};
use objc2_app_kit::NSWindow;
use objc2_core_graphics::{
    CGDirectDisplayID, CGDisplayChangeSummaryFlags, CGDisplayRegisterReconfigurationCallback,
    CGDisplayRemoveReconfigurationCallback, CGError,
};
use std::sync::Mutex;
use tauri::Emitter;

static DISPLAY_EVENTS: Mutex<Option<tauri::AppHandle>> = Mutex::new(None);

unsafe extern "C-unwind" fn display_changed(
    _: CGDirectDisplayID,
    flags: CGDisplayChangeSummaryFlags,
    _: *mut std::ffi::c_void,
) {
    if flags.contains(CGDisplayChangeSummaryFlags::BeginConfigurationFlag) {
        return;
    }
    let app = DISPLAY_EVENTS.lock().ok().and_then(|owner| owner.clone());
    if let Some(app) = app {
        let _ = app.emit("otto-display-changed", ());
    }
}

pub struct DisplayWatch;

impl DisplayWatch {
    pub fn start(app: tauri::AppHandle) -> Result<Self, String> {
        let mut owner = DISPLAY_EVENTS
            .lock()
            .map_err(|_| "Display observer unavailable.")?;
        if owner.is_some() {
            return Err("Display observer already registered.".into());
        }
        *owner = Some(app);
        drop(owner);
        let result = unsafe {
            CGDisplayRegisterReconfigurationCallback(Some(display_changed), std::ptr::null_mut())
        };
        if result != CGError::Success {
            if let Ok(mut owner) = DISPLAY_EVENTS.lock() {
                *owner = None;
            }
            return Err("Display changes could not be observed.".into());
        }
        Ok(Self)
    }
}

impl Drop for DisplayWatch {
    fn drop(&mut self) {
        unsafe {
            CGDisplayRemoveReconfigurationCallback(Some(display_changed), std::ptr::null_mut());
        }
        if let Ok(mut owner) = DISPLAY_EVENTS.lock() {
            *owner = None;
        }
    }
}

pub fn measure(window: &tauri::WebviewWindow) -> Result<DisplayGeometry, String> {
    let _main = MainThreadMarker::new().ok_or("Display geometry requires the main thread.")?;
    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    let native = unsafe { &*pointer.cast::<NSWindow>() };
    let screen = native.screen().ok_or("Monitor unavailable.")?;
    let frame = screen.frame();
    let visible = screen.visibleFrame();
    let menu_top = frame.origin.y + frame.size.height - visible.origin.y - visible.size.height;
    if !screen.respondsToSelector(sel!(safeAreaInsets))
        || !screen.respondsToSelector(sel!(auxiliaryTopLeftArea))
        || !screen.respondsToSelector(sel!(auxiliaryTopRightArea))
    {
        return Ok(approximate_geometry(menu_top));
    }
    let safe = screen.safeAreaInsets();
    let left = screen.auxiliaryTopLeftArea();
    let right = screen.auxiliaryTopRightArea();
    let valid_regions = left.size.height >= safe.top
        && right.size.height >= safe.top
        && left.size.width > 0.0
        && right.size.width > 0.0
        && (left.origin.y + left.size.height - frame.origin.y - frame.size.height).abs() < 1.0
        && (right.origin.y + right.size.height - frame.origin.y - frame.size.height).abs() < 1.0;
    let scale = screen.backingScaleFactor();
    if !scale.is_finite() || scale <= 0.0 {
        return Err("Invalid display scale.".into());
    }
    Ok(measured_geometry(
        frame.size.width,
        safe.top,
        if valid_regions {
            left.origin.x + left.size.width - frame.origin.x
        } else {
            0.0
        },
        if valid_regions {
            right.origin.x - frame.origin.x
        } else {
            0.0
        },
        menu_top,
    ))
}
