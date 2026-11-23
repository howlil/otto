use crate::shell::notch::RectPx;
use crate::shell::otto_os::unpack_notch;
use std::ptr::null;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};
use tauri::Emitter;
use windows_sys::Win32::Foundation::{HWND, RECT};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    FindWindowW, GW_HWNDPREV, GetPropW, GetWindow, GetWindowRect, HWND_TOPMOST, IsWindow,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SetWindowPos,
};

const BAR_CLASS: &str = "OttoNotchBar";
const NOTCH_PROPERTY: &str = "OttoOS.NotchRect";
const IDLE_INTERVAL: Duration = Duration::from_millis(1000);
const STATIC_BAR_INTERVAL: Duration = Duration::from_millis(250);
const FOLLOW_INTERVAL: Duration = Duration::from_millis(16);
const MOTION_COAST: Duration = Duration::from_millis(350);
const RAISE_INTERVAL: Duration = Duration::from_millis(1000);
pub const CHANGED_EVENT: &str = "otto-os-changed";

static BAR_CLASS_WIDE: LazyLock<Vec<u16>> = LazyLock::new(|| wide(BAR_CLASS));
static NOTCH_PROPERTY_WIDE: LazyLock<Vec<u16>> = LazyLock::new(|| wide(NOTCH_PROPERTY));

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Presence {
    pub bar: RectPx,
    pub notch: Option<RectPx>,
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}

fn find_bar() -> Option<HWND> {
    let hwnd = unsafe { FindWindowW(BAR_CLASS_WIDE.as_ptr(), null()) };
    (!hwnd.is_null()).then_some(hwnd)
}

fn resolve_bar(cached: &mut Option<HWND>) -> Option<HWND> {
    if let Some(hwnd) = *cached
        && unsafe { IsWindow(hwnd) } != 0
    {
        return Some(hwnd);
    }
    let found = find_bar();
    *cached = found;
    found
}

pub fn active() -> bool {
    find_bar().is_some()
}

fn presence_for(hwnd: HWND) -> Option<Presence> {
    let mut bar = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    if unsafe { GetWindowRect(hwnd, &mut bar) } == 0 {
        return None;
    }
    let packed = unsafe { GetPropW(hwnd, NOTCH_PROPERTY_WIDE.as_ptr()) } as usize as u64;
    Some(Presence {
        bar: RectPx {
            x: bar.left,
            y: bar.top,
            width: (bar.right - bar.left).max(0) as u32,
            height: (bar.bottom - bar.top).max(0) as u32,
        },
        notch: unpack_notch(packed, (bar.left, bar.top)),
    })
}

pub fn presence() -> Option<Presence> {
    let hwnd = find_bar()?;
    presence_for(hwnd)
}

pub fn pointer_pressed() -> bool {
    let down = |key| unsafe { GetAsyncKeyState(i32::from(key)) } < 0;
    down(VK_LBUTTON) || down(VK_RBUTTON)
}

fn raise_above_bar(otto: HWND, bar: HWND) {
    let mut above = bar;
    loop {
        above = unsafe { GetWindow(above, GW_HWNDPREV) };
        if above.is_null() {
            break;
        }
        if above == otto {
            return;
        }
    }
    unsafe {
        SetWindowPos(
            otto,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
}

fn watch_interval(bar_present: bool, motion_recent: bool) -> Duration {
    if !bar_present {
        IDLE_INTERVAL
    } else if motion_recent {
        FOLLOW_INTERVAL
    } else {
        STATIC_BAR_INTERVAL
    }
}

pub struct OttoOsWatch(Arc<AtomicBool>);

pub fn start(
    app: tauri::AppHandle,
    otto_hwnd: Option<isize>,
    on_presence: impl Fn(Presence) -> bool + Send + 'static,
) -> OttoOsWatch {
    let stop = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&stop);
    std::thread::spawn(move || {
        let mut cached_bar = find_bar();
        let mut active_before = cached_bar.is_some();
        let mut last_presence: Option<Presence> = None;
        let mut last_motion: Option<Instant> = None;
        let mut last_raise: Option<Instant> = None;
        while !flag.load(Ordering::Relaxed) {
            let motion_recent = last_motion.is_some_and(|at| at.elapsed() < MOTION_COAST);
            std::thread::sleep(watch_interval(active_before, motion_recent));
            let bar = resolve_bar(&mut cached_bar);
            let current = bar.and_then(|hwnd| {
                let value = presence_for(hwnd);
                if value.is_none() {
                    cached_bar = None;
                }
                value
            });
            if current.is_some() != active_before {
                active_before = current.is_some();
                last_raise = None;
                let _ = app.emit(CHANGED_EVENT, active_before);
                let _ = app.emit("otto-display-changed", ());
            }
            let (Some(bar_hwnd), Some(current)) = (bar, current) else {
                last_presence = None;
                last_motion = None;
                continue;
            };
            let presence_changed = last_presence != Some(current);
            last_presence = Some(current);
            let now = Instant::now();
            if let Some(hwnd) = otto_hwnd
                && (presence_changed
                    || last_raise
                        .is_none_or(|at| now.saturating_duration_since(at) >= RAISE_INTERVAL))
            {
                raise_above_bar(hwnd as HWND, bar_hwnd);
                last_raise = Some(now);
            }
            let followed = on_presence(current);
            if presence_changed || followed {
                last_motion = Some(now);
            }
        }
    });
    OttoOsWatch(stop)
}

impl Drop for OttoOsWatch {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn watch_interval_backs_off_when_bar_is_static_or_absent() {
        assert_eq!(watch_interval(false, false), IDLE_INTERVAL);
        assert_eq!(watch_interval(false, true), IDLE_INTERVAL);
        assert_eq!(watch_interval(true, true), FOLLOW_INTERVAL);
        assert_eq!(watch_interval(true, false), STATIC_BAR_INTERVAL);
    }

    #[test]
    fn static_wide_constants_are_null_terminated_utf16() {
        assert_eq!(BAR_CLASS_WIDE.last(), Some(&0));
        assert_eq!(NOTCH_PROPERTY_WIDE.last(), Some(&0));
        assert_eq!(
            String::from_utf16_lossy(&BAR_CLASS_WIDE[..BAR_CLASS_WIDE.len() - 1]),
            BAR_CLASS
        );
        assert_eq!(
            String::from_utf16_lossy(&NOTCH_PROPERTY_WIDE[..NOTCH_PROPERTY_WIDE.len() - 1]),
            NOTCH_PROPERTY
        );
    }
}
