use std::sync::Mutex;
use windows_sys::Win32::{
    Foundation::HWND,
    UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
        IsIconic, IsWindow, IsWindowVisible,
    },
};
pub(super) static LAST_EXTERNAL_WINDOW: Mutex<Option<WindowTarget>> = Mutex::new(None);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct WindowTarget {
    pub(super) handle: isize,
    pub(super) pid: u32,
}

impl WindowTarget {
    pub(super) fn matches(self, handle: isize, pid: u32) -> bool {
        self.handle == handle && self.pid == pid && pid != 0
    }

    pub(super) fn pin(hwnd: HWND) -> Option<Self> {
        let pid = window_pid(hwnd);
        (valid_capture_window(hwnd) && pid != 0).then_some(Self {
            handle: hwnd as isize,
            pid,
        })
    }
}

pub(super) fn window_pid(hwnd: HWND) -> u32 {
    if hwnd.is_null() {
        return 0;
    }
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    pid
}

pub(super) fn external_window(hwnd: HWND) -> bool {
    let pid = window_pid(hwnd);
    pid != 0 && pid != std::process::id()
}

pub(super) fn valid_capture_window(hwnd: HWND) -> bool {
    external_window(hwnd)
        && unsafe {
            IsWindow(hwnd) != 0
                && IsWindowVisible(hwnd) != 0
                && IsIconic(hwnd) == 0
                && GetWindowTextLengthW(hwnd) > 0
        }
}

pub(super) unsafe extern "system" fn on_foreground(
    _: windows_sys::Win32::UI::Accessibility::HWINEVENTHOOK,
    _: u32,
    hwnd: HWND,
    object: i32,
    child: i32,
    _: u32,
    _: u32,
) {
    if object != 0 || child != 0 {
        return;
    }
    if external_window(hwnd)
        && let Ok(mut last) = LAST_EXTERNAL_WINDOW.lock()
    {
        *last = WindowTarget::pin(hwnd);
    }
}

pub(super) fn choose_capture_target(
    foreground_pid: u32,
    own_pid: u32,
    current: Option<WindowTarget>,
    last: Option<WindowTarget>,
) -> Option<WindowTarget> {
    if foreground_pid == 0 {
        None
    } else if foreground_pid == own_pid {
        last
    } else {
        current
    }
}

pub(super) fn select_capture_target() -> Result<WindowTarget, String> {
    let current = unsafe { GetForegroundWindow() };
    let pid = window_pid(current);
    let last = *LAST_EXTERNAL_WINDOW
        .lock()
        .map_err(|_| "Window tracking is unavailable.")?;
    let target = choose_capture_target(pid, std::process::id(), WindowTarget::pin(current), last);
    let target = target.ok_or("Previous application window is unavailable. Focus it and retry.")?;
    if !valid_capture_window(target.handle as HWND)
        || !target.matches(target.handle, window_pid(target.handle as HWND))
    {
        return Err("Previous window changed or disappeared. Focus it and retry.".into());
    }
    Ok(target)
}

pub fn capture_target_title() -> Result<String, String> {
    let target = select_capture_target()?;
    let hwnd = target.handle as HWND;
    let len = unsafe { GetWindowTextLengthW(hwnd) };
    if len <= 0 {
        return Err("No named external window is available. Focus an app and retry.".into());
    }
    let mut buffer = vec![0u16; len.min(128) as usize + 1];
    let copied = unsafe { GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32) };
    if copied <= 0 || !target.matches(hwnd as isize, window_pid(hwnd)) {
        return Err("Window target changed. Refocus the app and retry.".into());
    }
    Ok(String::from_utf16_lossy(&buffer[..copied as usize]))
}
