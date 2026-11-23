use crate::shell::notch::{PositionPx, RectPx};

const MIN_CIRCLE: u32 = 24;
const MAX_CIRCLE: u32 = 64;
const GAP: f64 = 8.0;

pub fn unpack_notch(packed: u64, bar_origin: (i32, i32)) -> Option<RectPx> {
    let width = ((packed >> 32) & 0xFFFF) as u32;
    let height = ((packed >> 48) & 0xFFFF) as u32;
    if width == 0 || height == 0 {
        return None;
    }
    Some(RectPx {
        x: bar_origin.0 + i32::from((packed & 0xFFFF) as u16 as i16),
        y: bar_origin.1 + i32::from(((packed >> 16) & 0xFFFF) as u16 as i16),
        width,
        height,
    })
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CircleSlot {
    pub diameter: u32,
    pub position: PositionPx,
}

pub fn circle_slot(
    notch: RectPx,
    host_width: u32,
    monitor: RectPx,
    scale: f64,
) -> Option<CircleSlot> {
    if !scale.is_finite() || scale <= 0.0 {
        return None;
    }
    let diameter = ((f64::from(notch.height) / scale).round() as u32).clamp(MIN_CIRCLE, MAX_CIRCLE);
    let diameter_px = (f64::from(diameter) * scale).round() as i64;
    let gap_px = (GAP * scale).round() as i64;
    let center = i64::from(notch.x) + i64::from(notch.width) + gap_px + diameter_px / 2;
    let top = i64::from(notch.y) + (i64::from(notch.height) - diameter_px) / 2;
    let host_left = center - i64::from(host_width) / 2;
    let min_left = i64::from(monitor.x);
    let max_left =
        (i64::from(monitor.x) + i64::from(monitor.width) - i64::from(host_width)).max(min_left);
    Some(CircleSlot {
        diameter,
        position: PositionPx::plain(host_left.clamp(min_left, max_left) as i32, top as i32),
    })
}

const SPRING_RESPONSE_SECONDS: f64 = 0.26;
const SPRING_DAMPING_RATIO: f64 = 0.86;
const SPRING_SUBSTEP_SECONDS: f64 = 0.002;
const SPRING_STOP_DISTANCE: f64 = 0.5;
const SPRING_STOP_VELOCITY: f64 = 2.0;
const MAGNET_REACH: f64 = 16.0;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SpringAxis {
    position: f64,
    velocity: f64,
    initialized: bool,
}

impl SpringAxis {
    fn sync(&mut self, current: i32) {
        let current = f64::from(current);
        if !self.initialized || (self.position - current).abs() > 2.0 {
            self.position = current;
            self.velocity = 0.0;
            self.initialized = true;
        }
    }

    fn step(&mut self, current: i32, target: i32, dt_seconds: f64) -> i32 {
        self.sync(current);
        let goal = f64::from(target);
        if (self.position - goal).abs() <= SPRING_STOP_DISTANCE
            && self.velocity.abs() <= SPRING_STOP_VELOCITY
        {
            self.position = goal;
            self.velocity = 0.0;
            return target;
        }
        let dt = dt_seconds.clamp(0.001, 0.050);
        let substeps = ((dt / SPRING_SUBSTEP_SECONDS).ceil() as usize).clamp(1, 64);
        let h = dt / substeps as f64;
        let omega = std::f64::consts::TAU / SPRING_RESPONSE_SECONDS;
        let omega_sq = omega * omega;
        let two_zeta_omega = 2.0 * SPRING_DAMPING_RATIO * omega;
        let mut x = self.position;
        let mut v = self.velocity;
        for _ in 0..substeps {
            let accel = omega_sq * (goal - x) - two_zeta_omega * v;
            v += accel * h;
            x += v * h;
        }
        if (x - goal).abs() <= SPRING_STOP_DISTANCE && v.abs() <= SPRING_STOP_VELOCITY {
            self.position = goal;
            self.velocity = 0.0;
            target
        } else {
            self.position = x;
            self.velocity = v;
            x.round() as i32
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SpringFollow {
    x: SpringAxis,
    y: SpringAxis,
}

impl SpringFollow {
    pub fn reset(&mut self) {
        *self = Self::default();
    }

    pub fn step(&mut self, current: (i32, i32), target: (i32, i32), dt_seconds: f64) -> (i32, i32) {
        (
            self.x.step(current.0, target.0, dt_seconds),
            self.y.step(current.1, target.1, dt_seconds),
        )
    }

    pub fn is_moving(&self) -> bool {
        self.x.velocity.abs() > SPRING_STOP_VELOCITY || self.y.velocity.abs() > SPRING_STOP_VELOCITY
    }
}

pub fn in_dock_zone(host: RectPx, bar: RectPx, scale: f64) -> bool {
    let center = i64::from(host.x) + i64::from(host.width) / 2;
    let reach = (MAGNET_REACH * scale).round() as i64;
    center >= i64::from(bar.x)
        && center < i64::from(bar.x) + i64::from(bar.width)
        && i64::from(host.y) < i64::from(bar.y) + i64::from(bar.height) + reach
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monitor() -> RectPx {
        RectPx {
            x: 0,
            y: 0,
            width: 2240,
            height: 1400,
        }
    }

    #[test]
    fn unpack_adds_the_bar_origin_and_rejects_empty_rects() {
        let packed = 1020_u64 | (6_u64 << 16) | (300_u64 << 32) | (48_u64 << 48);
        assert_eq!(
            unpack_notch(packed, (0, 0)),
            Some(RectPx {
                x: 1020,
                y: 6,
                width: 300,
                height: 48
            })
        );
        assert_eq!(unpack_notch(packed, (100, 10)).unwrap().x, 1120);
        assert_eq!(unpack_notch(0, (0, 0)), None);
    }

    #[test]
    fn circle_sits_right_of_the_notch_at_notch_height_and_centered_vertically() {
        let notch = RectPx {
            x: 970,
            y: 6,
            width: 300,
            height: 48,
        };
        let slot = circle_slot(notch, 825, monitor(), 1.5).unwrap();
        assert_eq!(slot.diameter, 32);
        assert_eq!(slot.position.y, 6);
        let circle_center = slot.position.x + 825 / 2;
        assert_eq!(circle_center, 970 + 300 + 12 + 24);
    }

    #[test]
    fn host_never_leaves_the_monitor() {
        let notch = RectPx {
            x: 2100,
            y: 0,
            width: 100,
            height: 40,
        };
        let slot = circle_slot(notch, 825, monitor(), 1.0).unwrap();
        assert_eq!(slot.position.x, 2240 - 825);
    }

    #[test]
    fn spring_follow_preserves_momentum_and_lands_exactly() {
        let mut spring = SpringFollow::default();
        let mut position = (0, 0);
        let target = (200, 10);
        let mut steps = 0;
        let mut velocities_positive = false;
        while position != target {
            let next = spring.step(position, target, 0.016);
            if next.0 > position.0 {
                velocities_positive = true;
            }
            position = next;
            steps += 1;
            assert!(steps < 60);
        }
        assert!(velocities_positive);
        assert_eq!(spring.step(target, target, 0.016), target);
        assert_eq!(spring.step((0, 0), (0, 0), 0.016), (0, 0));

        let mut reversing = SpringFollow::default();
        let mut pos = (0, 0);
        for _ in 0..4 {
            pos = reversing.step(pos, (200, 0), 0.016);
        }
        let before_reverse = pos.0;
        let after_reverse = reversing.step(pos, (0, 0), 0.004);
        assert!(after_reverse.0 >= before_reverse);
    }

    #[test]
    fn dock_zone_covers_the_bar_and_a_little_below_it() {
        let bar = RectPx {
            x: 0,
            y: 0,
            width: 2240,
            height: 60,
        };
        let at = |x: i32, y: i32| RectPx {
            x,
            y,
            width: 825,
            height: 610,
        };
        assert!(in_dock_zone(at(700, 10), bar, 1.5));
        assert!(in_dock_zone(at(700, 80), bar, 1.5));
        assert!(!in_dock_zone(at(700, 300), bar, 1.5));
        assert!(!in_dock_zone(at(2200, 10), bar, 1.5));
    }

    #[test]
    fn invalid_scale_has_no_slot() {
        let notch = RectPx {
            x: 0,
            y: 0,
            width: 100,
            height: 40,
        };
        assert_eq!(circle_slot(notch, 100, monitor(), 0.0), None);
    }
}
