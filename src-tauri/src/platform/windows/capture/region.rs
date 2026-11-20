use super::{
    image::{MAX_EDGE, MAX_PIXELS, capture_rgba, capture_screen_rect, write_png_capture},
    region_overlay::{RegionOverlay, paint_border, show_overlay_rect, verify_capture_exclusion},
    region_scroll::RegionScrollCanvas,
    region_state::{RegionRect, SelectionAction, SelectionPhase, SelectionState},
    scroll::RgbaFrame,
};
use crate::agent::CapturedImageOutcome;
use std::{
    cell::{Cell, RefCell},
    ffi::c_void,
    mem::size_of,
    ptr::null_mut,
};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM},
    Graphics::{
        Dwm::DwmFlush,
        Gdi::{GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromPoint},
    },
    UI::WindowsAndMessaging::{
        CallNextHookEx, DefWindowProcW, DispatchMessageW, GetMessageW, GetSystemMetrics, HHOOK,
        HTTRANSPARENT, KBDLLHOOKSTRUCT, KillTimer, MA_NOACTIVATEANDEAT, MSG, MSLLHOOKSTRUCT,
        PostMessageW, PostQuitMessage, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
        SM_YVIRTUALSCREEN, SW_HIDE, SetTimer, SetWindowsHookExW, ShowWindow, TranslateMessage,
        UnhookWindowsHookEx, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_APP, WM_ERASEBKGND, WM_MOUSEACTIVATE,
        WM_NCACTIVATE, WM_NCCALCSIZE, WM_NCHITTEST, WM_NCPAINT, WM_PAINT, WM_TIMER,
    },
};

const WM_REGION_SYNC: u32 = WM_APP + 31;
const WM_REGION_FINISH: u32 = WM_APP + 32;
const TIMER_DEADLINE_ID: usize = 1;
const TIMER_CANCEL_RELEASE_ID: usize = 2;
const TIMER_SCROLL_SAMPLE_ID: usize = 3;
const TIMER_SCROLL_SETTLE_ID: usize = 4;
const SELECTION_DEADLINE_MS: u32 = 60_000;
const CANCEL_RELEASE_MS: u32 = 500;
const SCROLL_SAMPLE_MS: u32 = 90;
const SCROLL_SETTLE_MS: u32 = 260;

thread_local! {
    static ACTIVE_HWND: Cell<isize> = const { Cell::new(0) };
    static SELECTION_STATE: Cell<SelectionState> = const { Cell::new(SelectionState::new()) };
    static SYNC_QUEUED: Cell<bool> = const { Cell::new(false) };
    static CANCEL_TIMER_ARMED: Cell<bool> = const { Cell::new(false) };
    static SCROLL_SAMPLE_ARMED: Cell<bool> = const { Cell::new(false) };
    static CAPTURED_WHEEL_TICKS: Cell<u32> = const { Cell::new(0) };
    static SCROLL_INIT_ATTEMPTED: Cell<bool> = const { Cell::new(false) };
    static SHOWN_ONCE: Cell<bool> = const { Cell::new(false) };
    static SCROLL_CANVAS: RefCell<Option<RegionScrollCanvas>> = const { RefCell::new(None) };
}

struct SessionScope;

impl SessionScope {
    fn enter(hwnd: HWND) -> Self {
        ACTIVE_HWND.set(hwnd as isize);
        SELECTION_STATE.set(SelectionState::new());
        SYNC_QUEUED.set(false);
        CANCEL_TIMER_ARMED.set(false);
        SCROLL_SAMPLE_ARMED.set(false);
        CAPTURED_WHEEL_TICKS.set(0);
        SCROLL_INIT_ATTEMPTED.set(false);
        SHOWN_ONCE.set(false);
        SCROLL_CANVAS.with(|slot| *slot.borrow_mut() = None);
        Self
    }
}

impl Drop for SessionScope {
    fn drop(&mut self) {
        ACTIVE_HWND.set(0);
        SYNC_QUEUED.set(false);
        CANCEL_TIMER_ARMED.set(false);
        SCROLL_SAMPLE_ARMED.set(false);
        CAPTURED_WHEEL_TICKS.set(0);
        SCROLL_INIT_ATTEMPTED.set(false);
        SHOWN_ONCE.set(false);
        SCROLL_CANVAS.with(|slot| *slot.borrow_mut() = None);
    }
}

struct HookGuard(HHOOK);

impl HookGuard {
    fn install(
        kind: i32,
        proc: unsafe extern "system" fn(i32, WPARAM, LPARAM) -> LRESULT,
        instance: *mut c_void,
    ) -> Result<Self, String> {
        let hook = unsafe { SetWindowsHookExW(kind, Some(proc), instance, 0) };
        if hook.is_null() {
            return Err("Windows rejected the input hook for area selection.".into());
        }
        Ok(Self(hook))
    }
}

impl Drop for HookGuard {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                UnhookWindowsHookEx(self.0);
            }
        }
    }
}

struct TimerGuard {
    hwnd: HWND,
    id: usize,
}

impl Drop for TimerGuard {
    fn drop(&mut self) {
        if !self.hwnd.is_null() {
            unsafe {
                KillTimer(self.hwnd, self.id);
            }
        }
    }
}

fn dispatch_action(action: SelectionAction) {
    let raw = ACTIVE_HWND.get();
    if raw == 0 {
        return;
    }
    let hwnd = raw as HWND;
    if action.finish {
        unsafe {
            PostMessageW(hwnd, WM_REGION_FINISH, 0, 0);
        }
    } else if action.sync && !SYNC_QUEUED.replace(true) {
        unsafe {
            PostMessageW(hwnd, WM_REGION_SYNC, 0, 0);
        }
    }
}

unsafe extern "system" fn mouse_hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 && lparam != 0 {
        let info = unsafe { &*(lparam as *const MSLLHOOKSTRUCT) };
        let mut state = SELECTION_STATE.get();
        let action = state.on_mouse_input(wparam as u32, info.pt.x, info.pt.y, info.mouseData);
        SELECTION_STATE.set(state);
        dispatch_action(action);
        if action.swallow {
            return 1;
        }
    }
    unsafe { CallNextHookEx(null_mut(), code, wparam, lparam) }
}

unsafe extern "system" fn keyboard_hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 && lparam != 0 {
        let info = unsafe { &*(lparam as *const KBDLLHOOKSTRUCT) };
        let mut state = SELECTION_STATE.get();
        let action = state.on_key(wparam as u32, info.vkCode);
        SELECTION_STATE.set(state);
        dispatch_action(action);
        if action.swallow {
            return 1;
        }
    }
    unsafe { CallNextHookEx(null_mut(), code, wparam, lparam) }
}

fn monitor_bounds_at(x: i32, y: i32) -> RegionRect {
    unsafe {
        let monitor = MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONEAREST);
        if !monitor.is_null() {
            let mut info: MONITORINFO = std::mem::zeroed();
            info.cbSize = size_of::<MONITORINFO>() as u32;
            if GetMonitorInfoW(monitor, &mut info) != 0 {
                return RegionRect {
                    left: info.rcMonitor.left,
                    top: info.rcMonitor.top,
                    right: info.rcMonitor.right,
                    bottom: info.rcMonitor.bottom,
                };
            }
        }
    }
    virtual_screen_bounds()
}

fn capture_monitor_frame(bounds: RegionRect) -> Result<RgbaFrame, String> {
    capture_rgba(
        null_mut(),
        bounds.width(),
        bounds.height(),
        Some((bounds.left, bounds.top)),
    )
}

fn ensure_scroll_canvas_initialized(start_x: i32, start_y: i32) {
    if SCROLL_INIT_ATTEMPTED.replace(true) {
        return;
    }
    let monitor = monitor_bounds_at(start_x, start_y);
    if let Ok(initial) = capture_monitor_frame(monitor) {
        let canvas =
            RegionScrollCanvas::new(monitor, initial, MAX_EDGE as usize, MAX_PIXELS as usize);
        SCROLL_CANVAS.with(|slot| *slot.borrow_mut() = Some(canvas));
    }
}

fn sample_scroll_step(hwnd: HWND, state: &mut SelectionState) {
    let monitor =
        SCROLL_CANVAS.with(|slot| slot.borrow().as_ref().map(RegionScrollCanvas::monitor));
    let Some(monitor) = monitor else {
        return;
    };
    let Ok(frame) = capture_monitor_frame(monitor) else {
        return;
    };
    let updated_anchor = SCROLL_CANVAS.with(|slot| {
        let mut borrow = slot.borrow_mut();
        let canvas = borrow.as_mut()?;
        canvas.push_frame(frame, state.last_wheel_delta);
        Some(canvas.visual_anchor_y(state.start_y))
    });
    CAPTURED_WHEEL_TICKS.set(state.wheel_ticks);
    if let Some(anchor_y) = updated_anchor
        && state.update_scroll_anchor(anchor_y)
    {
        SELECTION_STATE.set(*state);
        show_overlay_rect(hwnd, state.visual_rect());
    }
}

unsafe extern "system" fn overlay_wnd_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match message {
        WM_NCCALCSIZE | WM_NCPAINT | WM_NCACTIVATE => 0,
        WM_ERASEBKGND => 1,
        WM_MOUSEACTIVATE => MA_NOACTIVATEANDEAT as LRESULT,
        WM_NCHITTEST => HTTRANSPARENT as LRESULT,
        WM_PAINT => {
            paint_border(hwnd);
            0
        }
        WM_REGION_SYNC => {
            SYNC_QUEUED.set(false);
            let mut state = SELECTION_STATE.get();
            match state.phase {
                SelectionPhase::Dragging => {
                    ensure_scroll_canvas_initialized(state.start_x, state.start_y);
                    if state.scrolled && state.wheel_ticks != CAPTURED_WHEEL_TICKS.get() {
                        if !SCROLL_SAMPLE_ARMED.replace(true) {
                            unsafe {
                                SetTimer(hwnd, TIMER_SCROLL_SAMPLE_ID, SCROLL_SAMPLE_MS, None);
                            }
                        }
                        unsafe {
                            SetTimer(hwnd, TIMER_SCROLL_SETTLE_ID, SCROLL_SETTLE_MS, None);
                        }
                    }
                    if show_overlay_rect(hwnd, state.visual_rect())
                        && !SHOWN_ONCE.replace(true)
                        && !verify_capture_exclusion(hwnd)
                    {
                        unsafe {
                            ShowWindow(hwnd, SW_HIDE);
                        }
                        state.phase = SelectionPhase::ProtectionFailed;
                        SELECTION_STATE.set(state);
                        unsafe {
                            PostQuitMessage(0);
                        }
                    }
                }
                SelectionPhase::Cancelling => {
                    unsafe {
                        ShowWindow(hwnd, SW_HIDE);
                    }
                    if !CANCEL_TIMER_ARMED.replace(true) {
                        unsafe {
                            SetTimer(hwnd, TIMER_CANCEL_RELEASE_ID, CANCEL_RELEASE_MS, None);
                        }
                    }
                }
                SelectionPhase::Selected
                | SelectionPhase::Cancelled
                | SelectionPhase::TimedOut
                | SelectionPhase::ProtectionFailed => unsafe {
                    ShowWindow(hwnd, SW_HIDE);
                },
                SelectionPhase::Armed => {}
            }
            0
        }
        WM_REGION_FINISH => {
            unsafe {
                ShowWindow(hwnd, SW_HIDE);
                PostQuitMessage(0);
            }
            0
        }
        WM_TIMER => {
            let mut state = SELECTION_STATE.get();
            if wparam == TIMER_SCROLL_SAMPLE_ID {
                if state.phase == SelectionPhase::Dragging && state.scrolled {
                    sample_scroll_step(hwnd, &mut state);
                }
            } else if wparam == TIMER_SCROLL_SETTLE_ID {
                unsafe {
                    KillTimer(hwnd, TIMER_SCROLL_SETTLE_ID);
                    KillTimer(hwnd, TIMER_SCROLL_SAMPLE_ID);
                }
                SCROLL_SAMPLE_ARMED.set(false);
                if state.phase == SelectionPhase::Dragging && state.scrolled {
                    sample_scroll_step(hwnd, &mut state);
                }
            } else if wparam == TIMER_CANCEL_RELEASE_ID {
                unsafe {
                    KillTimer(hwnd, TIMER_CANCEL_RELEASE_ID);
                }
                CANCEL_TIMER_ARMED.set(false);
                if state.on_cancel_release_timeout() {
                    SELECTION_STATE.set(state);
                    unsafe {
                        ShowWindow(hwnd, SW_HIDE);
                        PostQuitMessage(0);
                    }
                }
            } else if wparam == TIMER_DEADLINE_ID {
                unsafe {
                    KillTimer(hwnd, TIMER_DEADLINE_ID);
                }
                if state.on_deadline_timeout() {
                    SELECTION_STATE.set(state);
                    unsafe {
                        ShowWindow(hwnd, SW_HIDE);
                        PostQuitMessage(0);
                    }
                }
            }
            0
        }
        _ => unsafe { DefWindowProcW(hwnd, message, wparam, lparam) },
    }
}

fn virtual_screen_bounds() -> RegionRect {
    let left = unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) };
    let top = unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) };
    let width = unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) }.max(0);
    let height = unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) }.max(0);
    RegionRect {
        left,
        top,
        right: left.saturating_add(width),
        bottom: top.saturating_add(height),
    }
}

fn run_selection_session() -> Result<Option<(SelectionState, Option<RegionScrollCanvas>)>, String> {
    let overlay = RegionOverlay::create(overlay_wnd_proc)?;
    let _scope = SessionScope::enter(overlay.hwnd);
    let _mouse = HookGuard::install(WH_MOUSE_LL, mouse_hook_proc, overlay.instance)?;
    let _keyboard = HookGuard::install(WH_KEYBOARD_LL, keyboard_hook_proc, overlay.instance)?;
    unsafe {
        SetTimer(overlay.hwnd, TIMER_DEADLINE_ID, SELECTION_DEADLINE_MS, None);
    }
    let _deadline = TimerGuard {
        hwnd: overlay.hwnd,
        id: TIMER_DEADLINE_ID,
    };
    let _cancel_timer = TimerGuard {
        hwnd: overlay.hwnd,
        id: TIMER_CANCEL_RELEASE_ID,
    };
    let _scroll_sample = TimerGuard {
        hwnd: overlay.hwnd,
        id: TIMER_SCROLL_SAMPLE_ID,
    };
    let _scroll_settle = TimerGuard {
        hwnd: overlay.hwnd,
        id: TIMER_SCROLL_SETTLE_ID,
    };

    let mut message: MSG = unsafe { std::mem::zeroed() };
    while unsafe { GetMessageW(&mut message, null_mut(), 0, 0) } > 0 {
        unsafe {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }

    let final_state = SELECTION_STATE.get();
    let scroll_canvas = SCROLL_CANVAS.with(|slot| slot.borrow_mut().take());
    overlay.hide();
    drop(_scroll_settle);
    drop(_scroll_sample);
    drop(_cancel_timer);
    drop(_deadline);
    drop(_keyboard);
    drop(_mouse);
    drop(_scope);
    drop(overlay);

    match final_state.phase {
        SelectionPhase::Selected => Ok(Some((final_state, scroll_canvas))),
        SelectionPhase::Cancelled => Ok(None),
        SelectionPhase::TimedOut => {
            Err("Area selection timed out. Press the shortcut to try again.".into())
        }
        SelectionPhase::ProtectionFailed => {
            Err("Windows did not keep capture exclusion active on the selection overlay.".into())
        }
        _ => Ok(None),
    }
}

pub(super) fn capture_region() -> Result<CapturedImageOutcome, String> {
    let Some((final_state, scroll_canvas)) = run_selection_session()? else {
        return Ok(CapturedImageOutcome::Cancelled);
    };
    let _ = unsafe { DwmFlush() };
    if final_state.scrolled
        && let Some(mut canvas) = scroll_canvas
    {
        if let Ok(final_frame) = capture_monitor_frame(canvas.monitor()) {
            canvas.push_frame(final_frame, final_state.last_wheel_delta);
        }
        if let Some(cropped) = canvas.crop_selection(
            final_state.start_x,
            final_state.start_y,
            final_state.current_x,
            final_state.current_y,
        ) {
            return write_png_capture(&cropped).map(CapturedImageOutcome::Captured);
        }
    }
    let clamped = final_state.current_rect().clamp_to(virtual_screen_bounds());
    if !clamped.meets_minimum() {
        return Ok(CapturedImageOutcome::Cancelled);
    }
    capture_screen_rect(clamped.left, clamped.top, clamped.width(), clamped.height())
        .map(CapturedImageOutcome::Captured)
}
