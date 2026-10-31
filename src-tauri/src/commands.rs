use crate::agent::{AgentRuntime, Snapshot};
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(not(windows))]
use tauri::{LogicalSize, PhysicalPosition};
use tauri::{State, WebviewWindow, ipc::Channel};

#[derive(Default)]
pub struct NotchMotion {
    epoch: AtomicU64,
}

#[tauri::command]
pub fn agent_snapshot(runtime: State<'_, AgentRuntime>) -> Snapshot {
    runtime.snapshot()
}
#[tauri::command]
pub fn agent_codex_installed(runtime: State<'_, AgentRuntime>) -> bool {
    runtime.codex_installed()
}
#[tauri::command]
pub async fn agent_codex_readiness(
    runtime: State<'_, AgentRuntime>,
) -> crate::agent::ProviderReadiness {
    runtime.codex_readiness().await
}
#[tauri::command]
pub fn agent_subscribe(runtime: State<'_, AgentRuntime>, on_event: Channel<Snapshot>) {
    runtime.subscribe(on_event);
}
#[tauri::command]
pub async fn agent_ask(
    runtime: State<'_, AgentRuntime>,
    text: String,
    cwd: String,
    mode: String,
) -> Result<(), String> {
    runtime.ask(text, cwd, mode).await
}
#[tauri::command]
pub async fn agent_decide_approval(
    runtime: State<'_, AgentRuntime>,
    approval_id: String,
    decision: String,
) -> Result<(), String> {
    runtime.decide_approval(approval_id, decision).await
}
#[tauri::command]
pub async fn agent_stop(runtime: State<'_, AgentRuntime>) -> Result<(), String> {
    runtime.stop().await
}

#[tauri::command]
pub async fn agent_new_session(runtime: State<'_, AgentRuntime>) -> Result<(), String> {
    runtime.new_session().await
}

fn surface_size(surface: &str) -> Option<(u32, u32)> {
    match surface {
        "idle" => Some((92, 42)),
        "agentCompact" => Some((228, 50)),
        "home" => Some((452, 148)),
        "homeSettings" => Some((452, 314)),
        "agentReady" => Some((526, 170)),
        "agentThinking" => Some((526, 236)),
        "agentFull" => Some((526, 346)),
        "agentApproval" => Some((526, 336)),
        "agentError" => Some((526, 270)),
        "agentSettings" => Some((526, 466)),
        _ => None,
    }
}

// Monitor geometry is stable for the duration of one morph. Querying it per
// frame (current_monitor + scale_factor) costs several synchronous OS calls
// every 16 ms and makes the animation stutter, so it is resolved once here.
struct Frame {
    origin_x: i32,
    origin_y: i32,
    bounds_width: u32,
    scale: f64,
    last: Option<(i32, i32, i32, i32)>,
}

impl Frame {
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
            scale,
            last: None,
        })
    }

    // Each frame uses exactly one Win32 resize+position transaction.
    // Avoid the separate Tauri set_size / set_position calls: Windows could
    // paint between them, making the centered island visibly shake.
    fn apply(
        &mut self,
        window: &WebviewWindow,
        width: f64,
        height: f64,
        top_offset: u32,
    ) -> Result<(), String> {
        let physical_width = (width * self.scale).round() as i32;
        let physical_height = (height * self.scale).round() as i32;
        let x = self.origin_x + (self.bounds_width as i32 - physical_width) / 2;
        let y = self.origin_y + (f64::from(top_offset) * self.scale).round() as i32;
        let geometry = (physical_width, physical_height, x, y);
        if self.last == Some(geometry) {
            return Ok(());
        }
        #[cfg(windows)]
        {
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                SWP_NOACTIVATE, SWP_NOZORDER, SetWindowPos,
            };
            let hwnd = window
                .hwnd()
                .map_err(|_| "Cannot access the notch window.".to_string())?;
            // SAFETY: hwnd belongs to this live Tauri window; coordinates are
            // monitor-relative physical pixels. Neither activation nor Z-order
            // is modified. The OS handles cross-thread window positioning.
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
        Ok(())
    }
}

// Invert the CSS cubic Bezier's x(t) to sample its y(t). The reference's
// control points have y=1, so y(u) = 1 - (1-u)^3. This is monotonic and
// interruptible: a new target always starts at the actual current bounds.
fn home_ease(progress: f64) -> f64 {
    if progress <= 0.0 {
        return 0.0;
    }
    if progress >= 1.0 {
        return 1.0;
    }
    let (mut low, mut high) = (0.0_f64, 1.0_f64);
    for _ in 0..20 {
        let u = (low + high) / 2.0;
        let inv = 1.0 - u;
        let x = 3.0 * inv * inv * u * 0.22 + 3.0 * inv * u * u * 0.36 + u * u * u;
        if x < progress {
            low = u;
        } else {
            high = u;
        }
    }
    let inv = 1.0 - (low + high) / 2.0;
    1.0 - inv * inv * inv
}

#[tauri::command]
pub async fn notch_set_surface(
    window: WebviewWindow,
    motion: State<'_, NotchMotion>,
    surface: String,
    top_offset: u32,
    animate: bool,
) -> Result<(), String> {
    let (width, height) = surface_size(&surface).ok_or("Invalid notch surface.")?;
    if top_offset > 64 {
        return Err("Top offset must be between 0 and 64 px.".to_string());
    }
    // A new surface request interrupts an in-flight morph; no stale geometry can win.
    let token = motion.epoch.fetch_add(1, Ordering::SeqCst) + 1;
    let mut frame = Frame::capture(&window)?;
    let scale = frame.scale;
    let current = window.outer_size().map_err(|_| "Notch size unavailable.")?;
    let start_w = f64::from(current.width) / scale;
    let start_h = f64::from(current.height) / scale;
    let target_w = f64::from(width);
    let target_h = f64::from(height);
    if !animate || ((start_w - target_w).abs() < 1.0 && (start_h - target_h).abs() < 1.0) {
        return frame.apply(&window, target_w, target_h, top_offset);
    }
    let start = tokio::time::Instant::now();
    let duration = std::time::Duration::from_millis(420);
    let mut tick = tokio::time::interval(std::time::Duration::from_millis(16));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    tick.tick().await;
    loop {
        if motion.epoch.load(Ordering::SeqCst) != token {
            return Ok(());
        }
        let progress = (start.elapsed().as_secs_f64() / duration.as_secs_f64()).min(1.0);
        // Exactly match design/home.html's cubic-bezier(.22, 1, .36, 1).
        let eased = home_ease(progress);
        let w = start_w + (target_w - start_w) * eased;
        let h = start_h + (target_h - start_h) * eased;
        frame.apply(&window, w, h, top_offset)?;
        if progress >= 1.0 {
            break;
        }
        tick.tick().await;
    }
    // Land exactly on the target even if the last frame was skipped.
    frame.apply(&window, target_w, target_h, top_offset)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn home_curve_matches_css_and_never_reverses() {
        assert_eq!(home_ease(0.0), 0.0);
        assert_eq!(home_ease(1.0), 1.0);
        assert!((home_ease(0.25) - 0.765).abs() < 0.01);
        assert!((home_ease(0.5) - 0.961).abs() < 0.01);
        let samples: Vec<_> = (0..=100).map(|i| home_ease(f64::from(i) / 100.0)).collect();
        assert!(samples.windows(2).all(|p| p[0] <= p[1]));
    }
    #[test]
    fn approved_home_agent_and_settings_sizes() {
        assert_eq!(surface_size("home"), Some((452, 148)));
        assert_eq!(surface_size("agentReady"), Some((526, 170)));
        assert_eq!(surface_size("agentFull"), Some((526, 346)));
        assert_eq!(surface_size("agentApproval"), Some((526, 336)));
        assert_eq!(surface_size("agentSettings"), Some((526, 466)));
        assert_eq!(surface_size("unknown"), None);
    }
}
