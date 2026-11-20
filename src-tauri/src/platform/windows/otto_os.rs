use crate::shell::notch::RectPx;
use crate::shell::otto_os::unpack_notch;
use std::ptr::null;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::Emitter;
use windows_sys::Win32::Foundation::{HWND, RECT};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    FindWindowW, GW_HWNDPREV, GetPropW, GetWindow, GetWindowRect, HWND_TOPMOST, SWP_NOACTIVATE,
    SWP_NOMOVE, SWP_NOSIZE, SetWindowPos,
};

const BAR_CLASS: &str = "OttoNotchBar";
const NOTCH_PROPERTY: &str = "OttoOS.NotchRect";
const IDLE_INTERVAL: Duration = Duration::from_millis(1000);
const FOLLOW_INTERVAL: Duration = Duration::from_millis(16);
const RAISE_EVERY: u32 = 6;
pub const CHANGED_EVENT: &str = "otto-os-changed";

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Presence {
    pub bar: RectPx,
    pub notch: Option<RectPx>,
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}

fn find_bar() -> Option<HWND> {
    let hwnd = unsafe { FindWindowW(wide(BAR_CLASS).as_ptr(), null()) };
    (!hwnd.is_null()).then_some(hwnd)
}

pub fn active() -> bool {
    find_bar().is_some()
}

pub fn presence() -> Option<Presence> {
    let hwnd = find_bar()?;
    let mut bar = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    if unsafe { GetWindowRect(hwnd, &mut bar) } == 0 {
        return None;
    }
    let packed = unsafe { GetPropW(hwnd, wide(NOTCH_PROPERTY).as_ptr()) } as usize as u64;
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

pub fn pointer_pressed() -> bool {
    let down = |key| unsafe { GetAsyncKeyState(i32::from(key)) } < 0;
    down(VK_LBUTTON) || down(VK_RBUTTON)
}

fn raise_above_bar(otto: HWND) {
    let Some(bar) = find_bar() else {
        return;
    };
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

pub struct OttoOsWatch(Arc<AtomicBool>);

pub fn start(
    app: tauri::AppHandle,
    otto_hwnd: Option<isize>,
    on_presence: impl Fn(Presence) + Send + 'static,
) -> OttoOsWatch {
    let stop = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&stop);
    std::thread::spawn(move || {
        let mut active_before = active();
        let mut tick = 0_u32;
        while !flag.load(Ordering::Relaxed) {
            std::thread::sleep(if active_before {
                FOLLOW_INTERVAL
            } else {
                IDLE_INTERVAL
            });
            let current = presence();
            if current.is_some() != active_before {
                active_before = current.is_some();
                let _ = app.emit(CHANGED_EVENT, active_before);
                let _ = app.emit("otto-display-changed", ());
            }
            let Some(current) = current else {
                continue;
            };
            tick = tick.wrapping_add(1);
            if let Some(hwnd) = otto_hwnd
                && tick.is_multiple_of(RAISE_EVERY)
            {
                raise_above_bar(hwnd as HWND);
            }
            on_presence(current);
        }
    });
    OttoOsWatch(stop)
}

impl Drop for OttoOsWatch {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}
