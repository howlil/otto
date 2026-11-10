use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayGeometry {
    pub source: &'static str,
    pub notch_width: u32,
    pub notch_height: u32,
    pub safe_top: u32,
    pub menu_top: u32,
}

impl Default for DisplayGeometry {
    fn default() -> Self {
        Self {
            source: "approximate",
            notch_width: 185,
            notch_height: 32,
            safe_top: 0,
            menu_top: 0,
        }
    }
}

#[cfg(any(test, target_os = "macos"))]
pub fn approximate_geometry(menu_top: f64) -> DisplayGeometry {
    let top = if menu_top.is_finite() {
        menu_top.clamp(0.0, 128.0).ceil() as u32
    } else {
        0
    };
    DisplayGeometry {
        safe_top: top,
        menu_top: top,
        ..DisplayGeometry::default()
    }
}

#[cfg(any(test, target_os = "macos"))]
pub fn measured_geometry(
    screen_width: f64,
    safe_top: f64,
    left_end: f64,
    right_start: f64,
    menu_top: f64,
) -> DisplayGeometry {
    let menu_top = if menu_top.is_finite() {
        menu_top.clamp(0.0, 128.0).ceil() as u32
    } else {
        0
    };
    if safe_top == 0.0 && screen_width.is_finite() && screen_width > 0.0 {
        return DisplayGeometry {
            source: "notchless",
            menu_top,
            ..DisplayGeometry::default()
        };
    }
    let valid = [screen_width, safe_top, left_end, right_start]
        .iter()
        .all(|value| value.is_finite())
        && screen_width > 0.0
        && safe_top > 0.0
        && safe_top <= 128.0
        && left_end > 0.0
        && right_start > left_end
        && right_start < screen_width
        && (left_end + right_start - screen_width).abs() <= 2.0
        && right_start - left_end <= screen_width / 2.0;
    if !valid {
        return DisplayGeometry {
            safe_top: if safe_top.is_finite() {
                (safe_top.clamp(0.0, 128.0).ceil() as u32).max(menu_top)
            } else {
                menu_top
            },
            menu_top,
            ..DisplayGeometry::default()
        };
    }
    DisplayGeometry {
        source: "physical-notch",
        notch_width: (right_start - left_end).ceil() as u32,
        notch_height: safe_top.ceil() as u32,
        safe_top: safe_top.ceil() as u32,
        menu_top,
    }
}

pub fn drawable_monitor(
    display: &DisplayGeometry,
    attached: bool,
    monitor: crate::notch::RectPx,
    scale: f64,
) -> crate::notch::RectPx {
    let top = if !attached {
        (f64::from(display.menu_top.max(display.safe_top)) * scale).round() as u32
    } else {
        0
    };
    crate::notch::RectPx {
        y: monitor.y + top as i32,
        height: monitor.height.saturating_sub(top),
        ..monitor
    }
}

pub fn content_top(display: &DisplayGeometry, attached: bool) -> u32 {
    if attached { display.safe_top } else { 0 }
}

pub fn resolve_layouts(
    display: &DisplayGeometry,
    attached: bool,
) -> BTreeMap<&'static str, (u32, u32)> {
    let mut layouts = crate::notch::surface_layouts();
    let top = content_top(display, attached);
    layouts.insert(
        "idle",
        (
            display.notch_width,
            if top > 0 { 24 } else { display.notch_height },
        ),
    );
    for size in layouts.values_mut() {
        size.1 += top;
    }
    layouts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_is_the_only_layout_and_fallback_matches_the_reference() {
        let layouts = resolve_layouts(&DisplayGeometry::default(), false);
        assert_eq!(layouts["idle"], (185, 32));
        assert_eq!(layouts["agentCompact"], (228, 40));
        assert_eq!(layouts["musicCompact"], (264, 44));
        assert_eq!(layouts["focusCompact"], (224, 44));
        assert_eq!(layouts["osEvent"], (234, 44));
        assert_eq!(layouts["agentReady"], (526, 170));
    }

    #[test]
    fn detects_logical_resolution_changes_without_assuming_a_fixed_cutout() {
        let normal = measured_geometry(1728.0, 32.0, 771.5, 956.5, 32.0);
        let space = measured_geometry(2056.0, 38.0, 918.0, 1138.0, 38.0);
        assert_eq!((normal.notch_width, normal.notch_height), (185, 32));
        assert_eq!((space.notch_width, space.notch_height), (220, 38));
        assert_eq!(normal.source, "physical-notch");
        let layouts = resolve_layouts(&normal, true);
        assert_eq!(layouts["idle"], (185, 56));
        assert_eq!(layouts["musicPlayer"], (444, 210));
        assert_eq!(layouts["agentReady"], (526, 202));
        assert_eq!(resolve_layouts(&normal, false)["idle"], (185, 32));
    }

    #[test]
    fn menu_safe_bounds_stay_top_centered_at_each_display_scale() {
        let display = measured_geometry(1728.0, 32.0, 771.5, 956.5, 32.0);
        let monitor = crate::notch::RectPx {
            x: -1920,
            y: -1080,
            width: 1920,
            height: 1080,
        };
        for scale in [1.0, 1.5, 2.0] {
            for attached in [false, true] {
                let safe = drawable_monitor(&display, attached, monitor, scale);
                let bounds =
                    crate::notch::host_bounds(safe, 0, scale, (550, 610), attached, 20).unwrap();
                assert!((f64::from(bounds.x) + f64::from(bounds.width) / 2.0 + 960.0).abs() <= 0.5);
                assert_eq!(
                    bounds.y,
                    -1080 + if attached { 0 } else { (52.0 * scale) as i32 }
                );
                assert!(bounds.y + bounds.height as i32 <= 0);
            }
        }
    }

    #[test]
    fn missing_native_api_is_labeled_and_reserves_the_available_top_safe_area() {
        let fallback = approximate_geometry(38.0);
        assert_eq!(fallback.source, "approximate");
        assert_eq!(fallback.safe_top, 38);
        assert_eq!(resolve_layouts(&fallback, true)["idle"], (185, 62));
        assert_eq!(approximate_geometry(f64::NAN).safe_top, 0);
    }

    #[test]
    fn all_modules_keep_their_content_rows_outside_the_camera_housing() {
        let display = measured_geometry(1728.0, 32.0, 771.5, 956.5, 32.0);
        let floating = resolve_layouts(&display, false);
        let attached = resolve_layouts(&display, true);
        for (key, (width, height)) in floating {
            assert_eq!(attached[key].0, width);
            assert_eq!(
                attached[key].1,
                if key == "idle" { 56 } else { height + 32 }
            );
        }
    }

    #[test]
    fn notchless_and_bad_measurements_never_claim_a_physical_cutout() {
        assert_eq!(
            measured_geometry(1920.0, 0.0, 0.0, 0.0, 24.0).source,
            "notchless"
        );
        for (left, right) in [
            (0.0, 0.0),
            (900.0, 800.0),
            (100.0, 300.0),
            (f64::NAN, 900.0),
        ] {
            let display = measured_geometry(1728.0, 32.0, left, right, 32.0);
            assert_eq!(display.source, "approximate");
            assert_eq!(display.notch_width, 185);
            assert_eq!(display.safe_top, 32);
        }
    }
}
