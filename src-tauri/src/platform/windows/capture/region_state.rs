use windows_sys::Win32::UI::{
    Input::KeyboardAndMouse::VK_ESCAPE,
    WindowsAndMessaging::{
        WM_KEYDOWN, WM_KEYUP, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE, WM_MOUSEWHEEL,
        WM_RBUTTONDOWN, WM_RBUTTONUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
    },
};

const MIN_REGION_EDGE: i32 = 4;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct RegionRect {
    pub(super) left: i32,
    pub(super) top: i32,
    pub(super) right: i32,
    pub(super) bottom: i32,
}

impl RegionRect {
    pub(super) const fn from_points(x1: i32, y1: i32, x2: i32, y2: i32) -> Self {
        let (left, right) = if x1 <= x2 { (x1, x2) } else { (x2, x1) };
        let (top, bottom) = if y1 <= y2 { (y1, y2) } else { (y2, y1) };
        Self {
            left,
            top,
            right,
            bottom,
        }
    }

    pub(super) const fn width(self) -> i32 {
        self.right.saturating_sub(self.left)
    }

    pub(super) const fn height(self) -> i32 {
        self.bottom.saturating_sub(self.top)
    }

    pub(super) fn clamp_to(self, bounds: Self) -> Self {
        Self {
            left: self.left.clamp(bounds.left, bounds.right),
            top: self.top.clamp(bounds.top, bounds.bottom),
            right: self.right.clamp(bounds.left, bounds.right),
            bottom: self.bottom.clamp(bounds.top, bounds.bottom),
        }
    }

    pub(super) const fn meets_minimum(self) -> bool {
        self.width() >= MIN_REGION_EDGE && self.height() >= MIN_REGION_EDGE
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum SelectionPhase {
    Armed,
    Dragging,
    Cancelling,
    Selected,
    Cancelled,
    TimedOut,
    ProtectionFailed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct SelectionAction {
    pub(super) swallow: bool,
    pub(super) sync: bool,
    pub(super) finish: bool,
}

impl SelectionAction {
    pub(super) const PASS: Self = Self {
        swallow: false,
        sync: false,
        finish: false,
    };
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct SelectionState {
    pub(super) phase: SelectionPhase,
    pub(super) start_x: i32,
    pub(super) start_y: i32,
    pub(super) visual_start_y: i32,
    pub(super) current_x: i32,
    pub(super) current_y: i32,
    pub(super) scrolled: bool,
    pub(super) wheel_ticks: u32,
    pub(super) last_wheel_delta: i16,
    pub(super) hold_left: bool,
    pub(super) hold_right: bool,
    pub(super) hold_escape: bool,
}

impl SelectionState {
    pub(super) const fn new() -> Self {
        Self {
            phase: SelectionPhase::Armed,
            start_x: 0,
            start_y: 0,
            visual_start_y: 0,
            current_x: 0,
            current_y: 0,
            scrolled: false,
            wheel_ticks: 0,
            last_wheel_delta: 0,
            hold_left: false,
            hold_right: false,
            hold_escape: false,
        }
    }

    pub(super) const fn current_rect(self) -> RegionRect {
        RegionRect::from_points(self.start_x, self.start_y, self.current_x, self.current_y)
    }

    pub(super) const fn visual_rect(self) -> RegionRect {
        RegionRect::from_points(
            self.start_x,
            self.visual_start_y,
            self.current_x,
            self.current_y,
        )
    }

    pub(super) const fn meets_selection_minimum(self) -> bool {
        self.current_rect().meets_minimum() || self.visual_rect().meets_minimum()
    }

    pub(super) fn update_scroll_anchor(&mut self, visual_start_y: i32) -> bool {
        if self.visual_start_y != visual_start_y {
            self.visual_start_y = visual_start_y;
            true
        } else {
            false
        }
    }

    const fn has_held_inputs(self) -> bool {
        self.hold_left || self.hold_right || self.hold_escape
    }

    #[cfg(test)]
    pub(super) fn on_mouse(&mut self, message: u32, x: i32, y: i32) -> SelectionAction {
        self.on_mouse_input(message, x, y, 0)
    }

    pub(super) fn on_mouse_input(
        &mut self,
        message: u32,
        x: i32,
        y: i32,
        mouse_data: u32,
    ) -> SelectionAction {
        match message {
            WM_LBUTTONDOWN => match self.phase {
                SelectionPhase::Armed => {
                    self.phase = SelectionPhase::Dragging;
                    self.start_x = x;
                    self.start_y = y;
                    self.visual_start_y = y;
                    self.current_x = x;
                    self.current_y = y;
                    self.scrolled = false;
                    self.wheel_ticks = 0;
                    self.last_wheel_delta = 0;
                    self.hold_left = true;
                    SelectionAction {
                        swallow: true,
                        sync: true,
                        finish: false,
                    }
                }
                SelectionPhase::Dragging | SelectionPhase::Cancelling => {
                    self.hold_left = true;
                    SelectionAction {
                        swallow: true,
                        sync: false,
                        finish: false,
                    }
                }
                _ => SelectionAction::PASS,
            },
            WM_MOUSEMOVE => {
                if self.phase == SelectionPhase::Dragging {
                    self.current_x = x;
                    self.current_y = y;
                    SelectionAction {
                        swallow: false,
                        sync: true,
                        finish: false,
                    }
                } else {
                    SelectionAction::PASS
                }
            }
            WM_MOUSEWHEEL => {
                if self.phase == SelectionPhase::Dragging {
                    self.current_x = x;
                    self.current_y = y;
                    self.scrolled = true;
                    self.wheel_ticks = self.wheel_ticks.wrapping_add(1);
                    let delta = ((mouse_data >> 16) as u16) as i16;
                    if delta != 0 {
                        self.last_wheel_delta = delta;
                    }
                    SelectionAction {
                        swallow: false,
                        sync: true,
                        finish: false,
                    }
                } else {
                    SelectionAction::PASS
                }
            }
            WM_LBUTTONUP => match self.phase {
                SelectionPhase::Dragging if self.hold_left => {
                    self.hold_left = false;
                    self.current_x = x;
                    self.current_y = y;
                    self.phase = if self.meets_selection_minimum() {
                        SelectionPhase::Selected
                    } else {
                        SelectionPhase::Cancelled
                    };
                    SelectionAction {
                        swallow: true,
                        sync: true,
                        finish: true,
                    }
                }
                SelectionPhase::Cancelling if self.hold_left => {
                    self.hold_left = false;
                    let finish = !self.has_held_inputs();
                    if finish {
                        self.phase = SelectionPhase::Cancelled;
                    }
                    SelectionAction {
                        swallow: true,
                        sync: false,
                        finish,
                    }
                }
                _ => SelectionAction::PASS,
            },
            WM_RBUTTONDOWN => match self.phase {
                SelectionPhase::Armed | SelectionPhase::Dragging => {
                    self.hold_right = true;
                    self.phase = SelectionPhase::Cancelling;
                    SelectionAction {
                        swallow: true,
                        sync: true,
                        finish: false,
                    }
                }
                SelectionPhase::Cancelling => {
                    self.hold_right = true;
                    SelectionAction {
                        swallow: true,
                        sync: false,
                        finish: false,
                    }
                }
                _ => SelectionAction::PASS,
            },
            WM_RBUTTONUP => {
                if self.phase == SelectionPhase::Cancelling && self.hold_right {
                    self.hold_right = false;
                    let finish = !self.has_held_inputs();
                    if finish {
                        self.phase = SelectionPhase::Cancelled;
                    }
                    SelectionAction {
                        swallow: true,
                        sync: false,
                        finish,
                    }
                } else {
                    SelectionAction::PASS
                }
            }
            _ => SelectionAction::PASS,
        }
    }

    pub(super) fn on_key(&mut self, message: u32, vk_code: u32) -> SelectionAction {
        if vk_code != VK_ESCAPE as u32 {
            return SelectionAction::PASS;
        }
        match message {
            WM_KEYDOWN | WM_SYSKEYDOWN => match self.phase {
                SelectionPhase::Armed | SelectionPhase::Dragging => {
                    self.hold_escape = true;
                    self.phase = SelectionPhase::Cancelling;
                    SelectionAction {
                        swallow: true,
                        sync: true,
                        finish: false,
                    }
                }
                SelectionPhase::Cancelling => {
                    self.hold_escape = true;
                    SelectionAction {
                        swallow: true,
                        sync: false,
                        finish: false,
                    }
                }
                _ => SelectionAction::PASS,
            },
            WM_KEYUP | WM_SYSKEYUP => {
                if self.phase == SelectionPhase::Cancelling && self.hold_escape {
                    self.hold_escape = false;
                    let finish = !self.has_held_inputs();
                    if finish {
                        self.phase = SelectionPhase::Cancelled;
                    }
                    SelectionAction {
                        swallow: true,
                        sync: false,
                        finish,
                    }
                } else {
                    SelectionAction::PASS
                }
            }
            _ => SelectionAction::PASS,
        }
    }

    pub(super) fn on_cancel_release_timeout(&mut self) -> bool {
        if self.phase == SelectionPhase::Cancelling {
            self.phase = SelectionPhase::Cancelled;
            true
        } else {
            false
        }
    }

    pub(super) fn on_deadline_timeout(&mut self) -> bool {
        if matches!(
            self.phase,
            SelectionPhase::Armed | SelectionPhase::Dragging | SelectionPhase::Cancelling
        ) {
            self.phase = SelectionPhase::TimedOut;
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn region_rect_normalizes_all_drag_directions_and_clamps_virtual_screen() {
        let bounds = RegionRect {
            left: -1920,
            top: -1080,
            right: 2560,
            bottom: 1440,
        };
        let reverse = RegionRect::from_points(120, 480, -340, -60).clamp_to(bounds);
        assert_eq!(
            reverse,
            RegionRect {
                left: -340,
                top: -60,
                right: 120,
                bottom: 480,
            }
        );
        assert_eq!(reverse.width(), 460);
        assert_eq!(reverse.height(), 540);
        assert!(reverse.meets_minimum());

        let clipped = RegionRect::from_points(-2500, 100, -1800, 1600).clamp_to(bounds);
        assert_eq!(clipped.left, -1920);
        assert_eq!(clipped.right, -1800);
        assert_eq!(clipped.bottom, 1440);

        let tiny = RegionRect::from_points(10, 10, 13, 13);
        assert!(!tiny.meets_minimum());
    }

    #[test]
    fn selection_state_swallows_drag_clicks_without_blocking_cursor_motion() {
        let mut state = SelectionState::new();
        assert_eq!(state.on_mouse(WM_LBUTTONUP, 10, 10), SelectionAction::PASS);
        assert_eq!(state.phase, SelectionPhase::Armed);

        let down = state.on_mouse(WM_LBUTTONDOWN, 50, 60);
        assert!(down.swallow && down.sync && !down.finish);
        assert_eq!(state.phase, SelectionPhase::Dragging);

        let moved = state.on_mouse(WM_MOUSEMOVE, 250, 210);
        assert!(!moved.swallow && moved.sync && !moved.finish);
        assert_eq!(
            state.current_rect(),
            RegionRect {
                left: 50,
                top: 60,
                right: 250,
                bottom: 210,
            }
        );

        let up = state.on_mouse(WM_LBUTTONUP, 260, 220);
        assert!(up.swallow && up.finish);
        assert_eq!(state.phase, SelectionPhase::Selected);
    }

    #[test]
    fn tiny_drag_cancels_cleanly_without_leaking_click() {
        let mut state = SelectionState::new();
        assert!(state.on_mouse(WM_LBUTTONDOWN, 100, 100).swallow);
        let up = state.on_mouse(WM_LBUTTONUP, 102, 101);
        assert!(up.swallow && up.finish);
        assert_eq!(state.phase, SelectionPhase::Cancelled);
    }

    #[test]
    fn mouse_wheel_during_drag_passes_through_and_signals_scroll_sync() {
        let mut state = SelectionState::new();
        assert!(state.on_mouse(WM_LBUTTONDOWN, 100, 300).swallow);
        let wheel = state.on_mouse_input(WM_MOUSEWHEEL, 400, 301, ((-120i16 as u16) as u32) << 16);
        assert!(!wheel.swallow);
        assert!(wheel.sync);
        assert!(!wheel.finish);
        assert!(state.scrolled);
        assert_eq!(state.wheel_ticks, 1);
        assert_eq!(state.last_wheel_delta, -120);
        assert_eq!(state.phase, SelectionPhase::Dragging);
        assert_eq!(state.start_x, 100);
        assert_eq!(state.start_y, 300);

        assert!(state.update_scroll_anchor(120));
        assert_eq!(
            state.visual_rect(),
            RegionRect {
                left: 100,
                top: 120,
                right: 400,
                bottom: 301,
            }
        );
        let up = state.on_mouse(WM_LBUTTONUP, 400, 301);
        assert!(up.swallow && up.finish);
        assert_eq!(state.phase, SelectionPhase::Selected);
    }

    #[test]
    fn right_click_and_escape_swallow_both_down_and_up_including_held_drag() {
        let mut right = SelectionState::new();
        assert!(right.on_mouse(WM_LBUTTONDOWN, 20, 20).swallow);
        let rdown = right.on_mouse(WM_RBUTTONDOWN, 80, 80);
        assert!(rdown.swallow && rdown.sync && !rdown.finish);
        assert_eq!(right.phase, SelectionPhase::Cancelling);
        let rup = right.on_mouse(WM_RBUTTONUP, 80, 80);
        assert!(rup.swallow && !rup.finish);
        let lup = right.on_mouse(WM_LBUTTONUP, 80, 80);
        assert!(lup.swallow && lup.finish);
        assert_eq!(right.phase, SelectionPhase::Cancelled);

        let mut esc = SelectionState::new();
        assert_eq!(esc.on_key(WM_KEYDOWN, b'A' as u32), SelectionAction::PASS);
        let edown = esc.on_key(WM_KEYDOWN, VK_ESCAPE as u32);
        assert!(edown.swallow && edown.sync && !edown.finish);
        assert_eq!(esc.phase, SelectionPhase::Cancelling);
        let eup = esc.on_key(WM_KEYUP, VK_ESCAPE as u32);
        assert!(eup.swallow && eup.finish);
        assert_eq!(esc.phase, SelectionPhase::Cancelled);
    }
}
