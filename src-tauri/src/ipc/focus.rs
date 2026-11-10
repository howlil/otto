use crate::focus::{FocusTimerRuntime, TimerDurations, TimerPhase, TimerSnapshot};
use std::sync::Arc;
use tauri::{State, ipc::Channel};

#[tauri::command]
pub fn focus_timer_snapshot(runtime: State<'_, Arc<FocusTimerRuntime>>) -> TimerSnapshot {
    runtime.snapshot()
}

#[tauri::command]
pub fn focus_timer_subscribe(
    runtime: State<'_, Arc<FocusTimerRuntime>>,
    on_event: Channel<TimerSnapshot>,
) -> u64 {
    runtime.subscribe(on_event)
}

#[tauri::command]
pub fn focus_timer_unsubscribe(runtime: State<'_, Arc<FocusTimerRuntime>>, subscription_id: u64) {
    runtime.unsubscribe(subscription_id);
}

#[tauri::command]
pub fn focus_timer_start(
    runtime: State<'_, Arc<FocusTimerRuntime>>,
) -> Result<TimerSnapshot, String> {
    runtime.start()
}

#[tauri::command]
pub fn focus_timer_pause(
    runtime: State<'_, Arc<FocusTimerRuntime>>,
) -> Result<TimerSnapshot, String> {
    runtime.pause()
}

#[tauri::command]
pub fn focus_timer_reset(
    runtime: State<'_, Arc<FocusTimerRuntime>>,
) -> Result<TimerSnapshot, String> {
    runtime.reset()
}

#[tauri::command]
pub fn focus_timer_configure(
    runtime: State<'_, Arc<FocusTimerRuntime>>,
    durations: TimerDurations,
) -> Result<TimerSnapshot, String> {
    runtime.configure(durations)
}

#[tauri::command]
pub fn focus_timer_select_phase(
    runtime: State<'_, Arc<FocusTimerRuntime>>,
    phase: TimerPhase,
    discard_active: bool,
) -> Result<TimerSnapshot, String> {
    runtime.select_phase(phase, discard_active)
}

#[tauri::command]
pub fn focus_timer_start_next(
    runtime: State<'_, Arc<FocusTimerRuntime>>,
) -> Result<TimerSnapshot, String> {
    runtime.start_next()
}
