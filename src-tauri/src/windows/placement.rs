pub const SHOULDER: f64 = 12.0;
pub const ATTACHED_RADIUS: f64 = 24.0;
pub const CARD_RADIUS: f64 = 27.0;
const ARC_SEGMENTS: usize = 10;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Silhouette {
    Capsule,
    Card,
    Attached,
}

impl Silhouette {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "capsule" => Ok(Self::Capsule),
            "card" => Ok(Self::Card),
            "attached" => Ok(Self::Attached),
            _ => Err("Unknown notch silhouette.".to_string()),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shape {
    pub top: f64,
    pub bottom: f64,
    pub gutter: f64,
}

impl Shape {
    #[cfg(test)]
    pub fn attached(self) -> bool {
        self.gutter > 0.5
    }
}

pub fn shape_for(silhouette: Silhouette, height: f64, scale: f64) -> Shape {
    let limit = (height / 2.0).max(0.0);
    match silhouette {
        Silhouette::Capsule => Shape {
            top: limit,
            bottom: limit,
            gutter: 0.0,
        },
        Silhouette::Card => {
            let radius = (CARD_RADIUS * scale).min(limit);
            Shape {
                top: radius,
                bottom: radius,
                gutter: 0.0,
            }
        }
        Silhouette::Attached => Shape {
            top: 0.0,
            bottom: (ATTACHED_RADIUS * scale).min(limit),
            gutter: SHOULDER * scale,
        },
    }
}

fn shoulder_extension(gutter: f64, y: f64) -> f64 {
    if gutter <= 0.0 || y < 0.0 || y >= gutter {
        return 0.0;
    }
    let drop = gutter - y;
    gutter - (gutter * gutter - drop * drop).max(0.0).sqrt()
}

fn inside_corner(dx: f64, dy: f64, radius: f64) -> bool {
    dx * dx + dy * dy <= radius * radius
}

pub fn contains(shape: Shape, width: f64, height: f64, x: f64, y: f64) -> bool {
    if x < 0.0 || y < 0.0 || x > width || y > height {
        return false;
    }
    let gutter = shape.gutter;
    let spread = shoulder_extension(gutter, y);
    if x < gutter - spread || x > width - gutter + spread {
        return false;
    }
    let top = shape.top;
    if top > 0.0 && y < top {
        let left = gutter + top;
        let right = width - gutter - top;
        if x < left && !inside_corner(x - left, y - top, top) {
            return false;
        }
        if x > right && !inside_corner(x - right, y - top, top) {
            return false;
        }
    }
    let bottom = shape.bottom;
    if bottom > 0.0 && y > height - bottom {
        let left = gutter + bottom;
        let right = width - gutter - bottom;
        let dy = y - (height - bottom);
        if x < left && !inside_corner(x - left, dy, bottom) {
            return false;
        }
        if x > right && !inside_corner(x - right, dy, bottom) {
            return false;
        }
    }
    true
}

pub fn polygon(shape: Shape, width: f64, height: f64) -> Vec<(f64, f64)> {
    let gutter = shape.gutter;
    let top = shape.top;
    let bottom = shape.bottom;
    let right = width - gutter;
    let left = gutter;
    let quarter = std::f64::consts::FRAC_PI_2;
    let step_size = quarter / ARC_SEGMENTS as f64;
    let mut points = Vec::new();

    if gutter > 0.0 {
        points.push((0.0, 0.0));
        points.push((width, 0.0));
        for step in 1..=ARC_SEGMENTS {
            let y = gutter * step as f64 / ARC_SEGMENTS as f64;
            points.push((right + shoulder_extension(gutter, y), y));
        }
    } else {
        points.push((left + top, 0.0));
        points.push((right - top, 0.0));
        if top > 0.0 {
            for step in 1..=ARC_SEGMENTS {
                let angle = -quarter + step_size * step as f64;
                points.push((right - top + top * angle.cos(), top + top * angle.sin()));
            }
        }
    }

    if bottom > 0.0 {
        points.push((right, height - bottom));
        for step in 1..=ARC_SEGMENTS {
            let angle = step_size * step as f64;
            points.push((
                right - bottom + bottom * angle.cos(),
                height - bottom + bottom * angle.sin(),
            ));
        }
        points.push((left + bottom, height));
        for step in 1..=ARC_SEGMENTS {
            let angle = quarter + step_size * step as f64;
            points.push((
                left + bottom + bottom * angle.cos(),
                height - bottom + bottom * angle.sin(),
            ));
        }
    } else {
        points.push((right, height));
        points.push((left, height));
    }

    if gutter > 0.0 {
        for step in (0..ARC_SEGMENTS).rev() {
            let y = gutter * step as f64 / ARC_SEGMENTS as f64;
            points.push((left - shoulder_extension(gutter, y), y));
        }
    } else if top > 0.0 {
        for step in 1..=ARC_SEGMENTS {
            let angle = 2.0 * quarter + step_size * step as f64;
            points.push((left + top + top * angle.cos(), top + top * angle.sin()));
        }
    }

    points
}

use std::io;
use tauri::WebviewWindow;
use windows_sys::Win32::Foundation::{HWND, POINT};
use windows_sys::Win32::Graphics::Gdi::{
    ALTERNATE, CreatePolygonRgn, CreateRectRgn, DeleteObject, GetWindowRgn, PtInRegion, RGN_ERROR,
    SetWindowRgn,
};

fn sample_points(shape: Shape, width: f64, height: f64) -> Vec<(i32, i32)> {
    let samples = [
        (width / 2.0, height / 2.0),
        (shape.gutter + 2.0, 1.0),
        (1.0, shape.gutter + 2.0),
        (1.0, 1.0),
        (0.5, height - 0.5),
        (width - 0.5, height - 0.5),
    ];
    samples
        .into_iter()
        .map(|(x, y)| (x.round() as i32, y.round() as i32))
        .collect()
}

fn to_points(shape: Shape, width: f64, height: f64, offset_x: i32, offset_y: i32) -> Vec<POINT> {
    polygon(shape, width, height)
        .into_iter()
        .map(|(x, y)| POINT {
            x: x.round() as i32 + offset_x,
            y: y.round() as i32 + offset_y,
        })
        .collect()
}

pub fn create_region_at(
    shape: Shape,
    width: f64,
    height: f64,
    offset_x: i32,
    offset_y: i32,
) -> io::Result<*mut std::ffi::c_void> {
    let points = to_points(shape, width, height, offset_x, offset_y);
    let region = unsafe { CreatePolygonRgn(points.as_ptr(), points.len() as i32, ALTERNATE) };
    if region.is_null() {
        return Err(io::Error::last_os_error());
    }
    Ok(region)
}

pub fn region_contains(region: *mut std::ffi::c_void, x: i32, y: i32) -> bool {
    unsafe { PtInRegion(region, x, y) != 0 }
}

fn region_matches(
    region: *mut std::ffi::c_void,
    shape: Shape,
    width: f64,
    height: f64,
    offset_x: i32,
    offset_y: i32,
) -> bool {
    sample_points(shape, width, height)
        .into_iter()
        .all(|(x, y)| {
            region_contains(region, x + offset_x, y + offset_y)
                == contains(shape, width, height, f64::from(x), f64::from(y))
        })
}

fn window_region(hwnd: HWND) -> io::Result<*mut std::ffi::c_void> {
    let probe = unsafe { CreateRectRgn(0, 0, 0, 0) };
    if probe.is_null() {
        return Err(io::Error::last_os_error());
    }
    let kind = unsafe { GetWindowRgn(hwnd, probe) };
    if kind == RGN_ERROR {
        unsafe { DeleteObject(probe as _) };
        return Err(io::Error::last_os_error());
    }
    Ok(probe)
}

pub fn has_region(window: &WebviewWindow) -> io::Result<bool> {
    let hwnd = window.hwnd().map_err(io::Error::other)?.0 as HWND;
    match window_region(hwnd) {
        Ok(probe) => {
            unsafe { DeleteObject(probe as _) };
            Ok(true)
        }
        Err(_) => Ok(false),
    }
}

pub fn apply_region_at(
    window: &WebviewWindow,
    shape: Shape,
    width: f64,
    height: f64,
    offset_x: i32,
    offset_y: i32,
) -> io::Result<()> {
    let hwnd = window.hwnd().map_err(io::Error::other)?.0 as HWND;
    let region = create_region_at(shape, width, height, offset_x, offset_y)?;
    if unsafe { SetWindowRgn(hwnd, region, 1) } == 0 {
        unsafe { DeleteObject(region as _) };
        return Err(io::Error::last_os_error());
    }
    let applied = window_region(hwnd)?;
    let matches = region_matches(applied, shape, width, height, offset_x, offset_y);
    unsafe { DeleteObject(applied as _) };
    if matches {
        Ok(())
    } else {
        Err(io::Error::other(
            "The notch window region was not retained.",
        ))
    }
}

pub fn apply_rect_region(
    window: &WebviewWindow,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> io::Result<()> {
    let hwnd = window.hwnd().map_err(io::Error::other)?.0 as HWND;
    let region = unsafe { CreateRectRgn(x, y, x + width.max(1), y + height.max(1)) };
    if region.is_null() {
        return Err(io::Error::last_os_error());
    }
    if unsafe { SetWindowRgn(hwnd, region, 1) } == 0 {
        unsafe { DeleteObject(region as _) };
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

pub fn clear_region(window: &WebviewWindow) -> io::Result<()> {
    let hwnd = window.hwnd().map_err(io::Error::other)?.0 as HWND;
    unsafe { SetWindowRgn(hwnd, std::ptr::null_mut(), 1) };
    if has_region(window)? {
        return Err(io::Error::other("The notch window region was not cleared."));
    }
    Ok(())
}

pub fn apply_hit_region(
    window: &WebviewWindow,
    silhouette: Silhouette,
    scale: f64,
    current: (i32, i32),
    target: (i32, i32),
    plan: Option<(i32, i32, i32, i32)>,
) -> io::Result<()> {
    let Some((x, y, width, height)) = plan else {
        return Ok(());
    };
    if matches!(silhouette, Silhouette::Attached) {
        apply_region_at(
            window,
            shape_for(silhouette, f64::from(height), scale),
            f64::from(width),
            f64::from(height),
            x,
            y,
        )
    } else if target.0 < current.0 || target.1 < current.1 {
        apply_rect_region(window, x, y, width, height)
    } else {
        clear_region(window)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attached() -> Shape {
        shape_for(Silhouette::Attached, 346.0, 1.0)
    }

    #[test]
    fn parses_only_supported_silhouette_values() {
        assert_eq!(Silhouette::parse("capsule"), Ok(Silhouette::Capsule));
        assert_eq!(Silhouette::parse("card"), Ok(Silhouette::Card));
        assert_eq!(Silhouette::parse("attached"), Ok(Silhouette::Attached));
        assert!(Silhouette::parse("Attached").is_err());
        assert!(Silhouette::parse("floating").is_err());
        assert!(Silhouette::parse("island").is_err());
    }

    #[test]
    fn only_the_attached_silhouette_reserves_shoulder_space() {
        assert!(attached().attached());
        assert!(!shape_for(Silhouette::Capsule, 42.0, 1.0).attached());
        assert!(!shape_for(Silhouette::Card, 346.0, 1.0).attached());
    }

    #[test]
    fn shape_radii_follow_the_visual_tokens_and_height() {
        assert_eq!(
            shape_for(Silhouette::Card, 346.0, 1.0),
            Shape {
                top: 27.0,
                bottom: 27.0,
                gutter: 0.0
            }
        );
        assert_eq!(
            shape_for(Silhouette::Capsule, 42.0, 1.0),
            Shape {
                top: 21.0,
                bottom: 21.0,
                gutter: 0.0
            }
        );
        assert_eq!(
            shape_for(Silhouette::Attached, 20.0, 2.0),
            Shape {
                top: 0.0,
                bottom: 10.0,
                gutter: 24.0
            }
        );
        assert_eq!(attached().gutter, 12.0);
        assert_eq!(attached().bottom, 24.0);
    }

    #[test]
    fn attached_silhouette_reaches_the_screen_edge_through_curved_shoulders() {
        let shape = attached();
        let (width, height) = (526.0, 346.0);
        assert!(contains(shape, width, height, 263.0, 173.0));
        assert!(contains(shape, width, height, 12.0, 1.0));
        assert!(!contains(shape, width, height, 1.0, 1.0));
        assert!(!contains(shape, width, height, 1.0, 13.0));
        assert!(!contains(shape, width, height, 11.0, 8.0));
        assert!(contains(shape, width, height, 11.5, 8.0));
        assert!(contains(shape, width, height, 514.0, 1.0));
        assert!(!contains(shape, width, height, 525.0, 1.0));
    }

    #[test]
    fn bottom_corners_are_outside_every_silhouette() {
        let attached = attached();
        assert!(!contains(attached, 526.0, 346.0, 0.5, 345.5));
        assert!(!contains(attached, 526.0, 346.0, 525.5, 345.5));
        let capsule = shape_for(Silhouette::Capsule, 42.0, 1.0);
        assert!(!contains(capsule, 92.0, 42.0, 0.5, 0.5));
        assert!(!contains(capsule, 92.0, 42.0, 0.5, 41.5));
        assert!(contains(capsule, 92.0, 42.0, 46.0, 21.0));
        assert!(contains(capsule, 92.0, 42.0, 0.2, 21.0));
        assert!(!contains(capsule, 92.0, 42.0, 2.0, 0.5));
    }

    #[test]
    fn floating_card_keeps_rounded_top_and_bottom_corners() {
        let card = shape_for(Silhouette::Card, 346.0, 1.0);
        assert!(!contains(card, 526.0, 346.0, 0.5, 0.5));
        assert!(!contains(card, 526.0, 346.0, 525.5, 345.5));
        assert!(contains(card, 526.0, 346.0, 27.0, 27.0));
        assert!(contains(card, 526.0, 346.0, 263.0, 1.0));
    }

    #[test]
    fn region_polygon_matches_containment_on_the_native_geometry() {
        let shape = attached();
        let (width, height) = (526.0, 346.0);
        let region = create_region_at(shape, width, height, 0, 0).unwrap();
        for (x, y) in sample_points(shape, width, height) {
            let expected = contains(shape, width, height, f64::from(x), f64::from(y));
            assert!(
                region_contains(region, x, y) == expected,
                "sample {x},{y} disagrees with the intended silhouette"
            );
        }
        assert!(region_matches(region, shape, width, height, 0, 0));
        unsafe { DeleteObject(region as _) };
    }

    #[test]
    fn offset_region_keeps_the_silhouette_centered_inside_the_window() {
        let shape = shape_for(Silhouette::Attached, 63.0, 1.0);
        let region = create_region_at(shape, 138.0, 63.0, 270, 0).unwrap();
        assert!(region_contains(region, 339, 31));
        assert!(!region_contains(region, 69, 31));
        unsafe { DeleteObject(region as _) };
    }

    #[test]
    fn floating_polygon_closes_on_the_top_tangent_without_a_diagonal_wedge() {
        for (silhouette, width, height) in [
            (Silhouette::Capsule, 92.0, 42.0),
            (Silhouette::Card, 452.0, 148.0),
            (Silhouette::Card, 526.0, 346.0),
            (Silhouette::Card, 526.0, 466.0),
            (Silhouette::Card, 526.0, 610.0),
        ] {
            let shape = shape_for(silhouette, height, 1.0);
            let points = polygon(shape, width, height);
            let first = points.first().unwrap();
            let last = points.last().unwrap();
            assert!(
                (first.0 - last.0).abs() < 0.001 && (first.1 - last.1).abs() < 0.001,
                "{silhouette:?}: top-left arc must close at the upper tangent"
            );

            let region = create_region_at(shape, width, height, 0, 0).unwrap();
            for x in [2, 5, 10] {
                let y = (height / 2.0) as i32;
                assert!(
                    region_contains(region, x, y),
                    "{silhouette:?} {width}x{height}: left-edge interior {x},{y} was clipped"
                );
                assert!(
                    region_contains(region, width as i32 - 1 - x, y),
                    "{silhouette:?} {width}x{height}: right-edge interior was clipped"
                );
            }
            assert!(!region_contains(region, 1, 1));
            assert!(region_contains(region, width as i32 / 2, 1));
            unsafe { DeleteObject(region as _) };
        }
    }

    #[test]
    fn capsule_region_excludes_its_rounded_corners() {
        let shape = shape_for(Silhouette::Capsule, 42.0, 1.0);
        let region = create_region_at(shape, 92.0, 42.0, 0, 0).unwrap();
        assert!(region_contains(region, 46, 21));
        assert!(!region_contains(region, 1, 1));
        assert!(!region_contains(region, 91, 41));
        unsafe { DeleteObject(region as _) };
    }

    #[test]
    fn visual_tokens_match_the_canonical_stylesheet() {
        let css = include_str!("../../../src/style.css");
        for token in [
            "--otto-shoulder: 12px;",
            "--radius-otto-attached: 24px;",
            "--radius-otto-expanded: 27px;",
        ] {
            assert!(css.contains(token), "style.css is missing {token}");
        }
    }
}
