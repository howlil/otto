#[cfg(windows)]
use crate::windows::placement::{Silhouette, shape_for};

pub const MAX_TOP_OFFSET: u32 = 64;

pub fn content_size(
    surface: &str,
    content_height: Option<u32>,
    available_height: u32,
) -> Option<(u32, u32)> {
    let (width, base_height) = surface_size(surface)?;
    if !matches!(
        surface,
        "agentReady"
            | "agentThinking"
            | "agentFull"
            | "agentError"
            | "homeSettings"
            | "agentSettings"
    ) {
        return Some((width, base_height));
    }
    let min_height = if matches!(
        surface,
        "agentReady" | "agentThinking" | "agentFull" | "agentError"
    ) {
        170
    } else {
        1
    };
    let max_height = 610.min(available_height.max(min_height));
    let height = content_height
        .map(|value| value.clamp(min_height, max_height))
        .unwrap_or(base_height);
    Some((width, height))
}

pub fn surface_target(
    surface: &str,
    shape: &str,
    content_height: Option<u32>,
    available_height: u32,
) -> Option<(u32, u32, f64, f64)> {
    let (body_width, height) = content_size(surface, content_height, available_height)?;
    let gutter = attached_gutter(shape);
    Some((
        body_width,
        height,
        f64::from(body_width) + gutter * 2.0,
        f64::from(height),
    ))
}

pub fn surface_size(surface: &str) -> Option<(u32, u32)> {
    match surface {
        "idle" => Some((92, 42)),
        "agentCompact" => Some((228, 50)),
        "home" => Some((452, 148)),
        "homeSettings" => Some((452, 314)),
        "agentReady" => Some((526, 170)),
        "agentThinking" => Some((526, 236)),
        "agentFull" => Some((526, 346)),
        "agentError" => Some((526, 270)),
        "agentSettings" => Some((526, 466)),
        "osEvent" => Some((234, 52)),
        _ => None,
    }
}

pub fn needs_region_update(
    previous: Option<&(String, i32, i32)>,
    shape: &str,
    size: (i32, i32),
) -> bool {
    match previous {
        Some((previous_shape, width, height)) => {
            previous_shape != shape || (*width, *height) != size
        }
        None => true,
    }
}

pub fn window_size(current: (f64, f64), target: (f64, f64), defer_shrink: bool) -> (f64, f64) {
    if defer_shrink {
        (current.0.max(target.0), current.1.max(target.1))
    } else {
        target
    }
}

pub fn top_inset(attached: bool, top_offset: u32) -> u32 {
    if attached { 0 } else { top_offset }
}

pub fn placement_origin(
    bounds_x: i32,
    bounds_y: i32,
    bounds_width: u32,
    physical_width: i32,
    scale: f64,
    inset: u32,
) -> (i32, i32) {
    let x = bounds_x + (bounds_width as i32 - physical_width) / 2;
    let y = bounds_y + (f64::from(inset) * scale).round() as i32;
    (x, y)
}

pub fn attached_gutter(shape: &str) -> f64 {
    #[cfg(windows)]
    {
        Silhouette::parse(shape)
            .map(|silhouette| shape_for(silhouette, 0.0, 1.0).gutter)
            .unwrap_or(0.0)
    }
    #[cfg(not(windows))]
    {
        let _ = shape;
        0.0
    }
}

pub fn hit_region_plan(current: (i32, i32), target: (i32, i32)) -> Option<(i32, i32, i32, i32)> {
    if current == target || current.0 <= 0 || current.1 <= 0 || target.0 <= 0 || target.1 <= 0 {
        return None;
    }
    Some((
        ((current.0 - target.0) / 2).max(0),
        0,
        target.0.min(current.0),
        target.1.min(current.1),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hit_region_tracks_the_visible_surface_inside_a_larger_window() {
        assert_eq!(
            hit_region_plan((678, 222), (678, 222)),
            None
        );
        assert_eq!(
            hit_region_plan((678, 222), (138, 63)),
            Some((270, 0, 138, 63))
        );
        assert_eq!(
            hit_region_plan((138, 63), (678, 222)),
            Some((0, 0, 138, 63))
        );
        assert_eq!(hit_region_plan((0, 0), (138, 63)), None);
        assert_eq!(hit_region_plan((678, 222), (0, 63)), None);
    }

    #[test]
    fn window_geometry_only_grows_when_the_shrink_is_deferred() {
        assert_eq!(
            window_size((92.0, 42.0), (452.0, 148.0), false),
            (452.0, 148.0)
        );
        assert_eq!(
            window_size((92.0, 42.0), (452.0, 148.0), true),
            (452.0, 148.0)
        );
        assert_eq!(
            window_size((452.0, 148.0), (92.0, 42.0), false),
            (92.0, 42.0)
        );
        assert_eq!(
            window_size((452.0, 148.0), (92.0, 42.0), true),
            (452.0, 148.0)
        );
        assert_eq!(
            window_size((452.0, 148.0), (526.0, 620.0), true),
            (526.0, 620.0)
        );
        assert_eq!(
            window_size((526.0, 620.0), (526.0, 170.0), true),
            (526.0, 620.0)
        );
    }

    #[test]
    fn window_region_work_is_skipped_while_the_silhouette_is_unchanged() {
        let capsule = Some(("capsule".to_string(), 138, 63));
        assert!(needs_region_update(None, "capsule", (138, 63)));
        assert!(!needs_region_update(capsule.as_ref(), "capsule", (138, 63)));
        assert!(needs_region_update(capsule.as_ref(), "capsule", (678, 222)));
        assert!(needs_region_update(capsule.as_ref(), "card", (138, 63)));
        assert!(needs_region_update(capsule.as_ref(), "attached", (138, 63)));
    }

    #[test]
    fn dynamic_surface_height_is_bounded() {
        assert_eq!(content_size("agentFull", Some(98), 900), Some((526, 170)));
        assert_eq!(content_size("agentFull", Some(410), 900), Some((526, 410)));
        assert_eq!(content_size("agentFull", Some(850), 900), Some((526, 610)));
        assert_eq!(content_size("agentFull", Some(580), 420), Some((526, 420)));
        assert_eq!(
            content_size("agentSettings", Some(580), 900),
            Some((526, 580))
        );
        assert_eq!(
            content_size("homeSettings", Some(190), 900),
            Some((452, 190))
        );
        assert_eq!(content_size("home", Some(580), 900), Some((452, 148)));
    }

    #[test]
    fn attached_placement_ignores_the_floating_offset_and_keeps_the_screen_edge() {
        assert_eq!(top_inset(true, 40), 0);
        assert_eq!(top_inset(false, 40), 40);
        assert_eq!(
            placement_origin(0, 0, 1920, 550, 1.0, top_inset(true, 40)).1,
            0
        );
        assert_eq!(
            placement_origin(0, 0, 1920, 92, 1.25, top_inset(false, 20)),
            ((1920 - 92) / 2, 25)
        );
        assert_eq!(
            placement_origin(-1920, -240, 2560, 374, 1.0, 0),
            (-1920 + (2560 - 374) / 2, -240)
        );
    }

    #[test]
    fn attached_placement_reserves_shoulder_space_in_the_window_width() {
        assert_eq!(attached_gutter("attached"), 12.0);
        assert_eq!(attached_gutter("capsule"), 0.0);
        assert_eq!(attached_gutter("card"), 0.0);
    }

    #[test]
    fn approved_home_agent_and_settings_sizes() {
        assert_eq!(surface_size("home"), Some((452, 148)));
        assert_eq!(surface_size("agentReady"), Some((526, 170)));
        assert_eq!(surface_size("agentFull"), Some((526, 346)));
        assert_eq!(surface_size("agentSettings"), Some((526, 466)));
        assert_eq!(surface_size("osEvent"), Some((234, 52)));
        assert_eq!(surface_size("unknown"), None);
    }

    #[test]
    fn surface_target_keeps_attached_shoulder_space_outside_the_body() {
        assert_eq!(
            surface_target("osEvent", "attached", None, 900),
            Some((234, 52, 258.0, 52.0))
        );
    }
}
