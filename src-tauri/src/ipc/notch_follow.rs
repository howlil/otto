use super::notch::{NotchHostState, Track};
use crate::shell::notch::RectPx;
use crate::shell::otto_os::{SpringFollow, circle_slot, in_dock_zone};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

const SIGNAL_INTERVAL: Duration = Duration::from_millis(500);
const DEFAULT_FRAME_SECONDS: f64 = 0.016;

struct FollowPlan {
    track: Option<Track>,
    scale: f64,
    signal_due: bool,
    spring: SpringFollow,
    dt_seconds: f64,
}

fn follow_plan(state: &NotchHostState, now: Instant) -> Option<FollowPlan> {
    let state = state.0.try_lock().ok()?;
    let host = state.host.as_ref()?;
    if !state.revealed || !host.view.otto_os {
        return None;
    }
    let dt_seconds = state
        .last_follow
        .map_or(DEFAULT_FRAME_SECONDS, |last| {
            now.saturating_duration_since(last).as_secs_f64()
        })
        .clamp(0.001, 0.050);
    Some(FollowPlan {
        track: host.track,
        scale: host.view.scale,
        signal_due: state
            .last_signal
            .is_none_or(|last| last.elapsed() >= SIGNAL_INTERVAL),
        spring: state.follow_spring,
        dt_seconds,
    })
}

fn window_bounds(hwnd: isize) -> Option<RectPx> {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowRect;
    let mut rect = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    if unsafe { GetWindowRect(hwnd as _, &mut rect) } == 0 {
        return None;
    }
    Some(RectPx {
        x: rect.left,
        y: rect.top,
        width: (rect.right - rect.left).max(0) as u32,
        height: (rect.bottom - rect.top).max(0) as u32,
    })
}

fn move_window(hwnd: isize, x: i32, y: i32) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER, SetWindowPos,
    };
    unsafe {
        SetWindowPos(
            hwnd as _,
            std::ptr::null_mut(),
            x,
            y,
            0,
            0,
            SWP_NOACTIVATE | SWP_NOSIZE | SWP_NOZORDER,
        );
    }
}

pub fn follow(
    app: &tauri::AppHandle,
    hwnd: isize,
    presence: crate::platform::windows::otto_os::Presence,
) {
    if crate::platform::windows::otto_os::pointer_pressed() {
        return;
    }
    let state = app.state::<NotchHostState>();
    let now = Instant::now();
    let Some(mut plan) = follow_plan(&state, now) else {
        return;
    };
    let Some(current) = window_bounds(hwnd) else {
        return;
    };
    let mut target = None;
    let signal = match plan.track {
        Some(track) => {
            let Some(slot) = presence
                .notch
                .and_then(|notch| circle_slot(notch, track.host_width, track.monitor, track.scale))
            else {
                return;
            };
            if slot.diameter != track.diameter {
                Some("otto-display-changed")
            } else {
                target = Some(slot.position);
                let next = plan.spring.step(
                    (current.x, current.y),
                    (slot.position.x, slot.position.y),
                    plan.dt_seconds,
                );
                if next != (current.x, current.y) {
                    move_window(hwnd, next.0, next.1);
                }
                None
            }
        }
        None => in_dock_zone(current, presence.bar, plan.scale).then_some("otto-os-dock"),
    };
    let signal = signal.filter(|_| plan.signal_due);
    if target.is_none() && signal.is_none() {
        return;
    }
    if let Ok(mut state) = state.0.try_lock() {
        if let (Some(position), Some(host)) = (target, state.host.as_mut()) {
            host.bounds.x = position.x;
            host.bounds.y = position.y;
            state.follow_spring = plan.spring;
            state.last_follow = Some(now);
        }
        if signal.is_some() {
            state.last_signal = Some(now);
        }
    }
    if let Some(event) = signal {
        let _ = app.emit(event, ());
    }
}
