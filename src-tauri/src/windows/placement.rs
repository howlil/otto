#[cfg(test)]
pub const SHOULDER: f64 = 12.0;
#[cfg(test)]
pub const ATTACHED_RADIUS: f64 = 24.0;
#[cfg(test)]
pub const CARD_RADIUS: f64 = 27.0;
#[cfg(test)]
const ARC_SEGMENTS: usize = 10;

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Silhouette {
    Capsule,
    Card,
    Attached,
}

#[cfg(test)]
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

#[cfg(test)]
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

#[cfg(test)]
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

fn left_boundary(shape: Shape, height: f64, y: f64) -> f64 {
    let mut left = shape.gutter - shoulder_extension(shape.gutter, y);
    if shape.top > 0.0 && y < shape.top {
        left = left.max(
            shape.gutter + shape.top
                - (shape.top.powi(2) - (shape.top - y).powi(2))
                    .max(0.0)
                    .sqrt(),
        );
    }
    if shape.bottom > 0.0 && y > height - shape.bottom {
        left = left.max(
            shape.gutter + shape.bottom
                - (shape.bottom.powi(2) - (y - height + shape.bottom).powi(2))
                    .max(0.0)
                    .sqrt(),
        );
    }
    left
}

fn to_points(shape: Shape, width: f64, height: f64, offset_x: i32, offset_y: i32) -> Vec<POINT> {
    let rows: Vec<_> = (0..height.ceil() as i32)
        .map(|y| {
            let top = f64::from(y);
            let bottom = (top + 1.0).min(height);
            let edge = left_boundary(shape, height, top).min(left_boundary(shape, height, bottom));
            (y, edge.floor() as i32, (width - edge).ceil() as i32)
        })
        .collect();
    let mut points = Vec::with_capacity(rows.len() * 4);
    for &(y, left, _) in &rows {
        points.push(POINT {
            x: left + offset_x,
            y: y + offset_y,
        });
        points.push(POINT {
            x: left + offset_x,
            y: y + 1 + offset_y,
        });
    }
    for &(y, _, right) in rows.iter().rev() {
        points.push(POINT {
            x: right + offset_x,
            y: y + 1 + offset_y,
        });
        points.push(POINT {
            x: right + offset_x,
            y: y + offset_y,
        });
    }
    points
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

fn reported_geometry(region: &crate::notch::RegionPx) -> (Shape, f64, f64, i32, i32) {
    (
        Shape {
            top: f64::from(region.radius.top),
            bottom: f64::from(region.radius.bottom),
            gutter: f64::from(region.shoulder),
        },
        f64::from(region.body.width) + 2.0 * f64::from(region.shoulder),
        f64::from(region.body.height),
        region.body.x - region.shoulder as i32,
        region.body.y,
    )
}

pub fn apply_reported_region(
    window: &WebviewWindow,
    region: &crate::notch::RegionPx,
    previous: Option<&crate::notch::RegionPx>,
    verify: bool,
) -> io::Result<()> {
    use windows_sys::Win32::Graphics::Gdi::{CombineRgn, InvalidateRgn, RGN_DIFF};
    let hwnd = window.hwnd().map_err(io::Error::other)?.0 as HWND;
    let (shape, width, height, x, y) = reported_geometry(region);
    let next = create_region_at(shape, width, height, x, y)?;
    let old = if let Some(previous) = previous {
        let (shape, width, height, x, y) = reported_geometry(previous);
        match create_region_at(shape, width, height, x, y) {
            Ok(region) => region,
            Err(error) => {
                unsafe {
                    DeleteObject(next as _);
                }
                return Err(error);
            }
        }
    } else {
        unsafe { CreateRectRgn(0, 0, 0, 0) }
    };
    let exposed = unsafe { CreateRectRgn(0, 0, 0, 0) };
    if old.is_null() || exposed.is_null() {
        unsafe {
            DeleteObject(next as _);
            DeleteObject(old as _);
            DeleteObject(exposed as _);
        }
        return Err(io::Error::last_os_error());
    }
    let combined = unsafe { CombineRgn(exposed, next, old, RGN_DIFF) };
    if combined == RGN_ERROR || unsafe { SetWindowRgn(hwnd, next, 0) } == 0 {
        unsafe {
            DeleteObject(next as _);
            DeleteObject(old as _);
            DeleteObject(exposed as _);
        }
        return Err(io::Error::last_os_error());
    }
    let retained = !verify
        || window_region(hwnd).is_ok_and(|applied| {
            let matches = region_matches(applied, shape, width, height, x, y);
            unsafe {
                DeleteObject(applied as _);
            }
            matches
        });
    if !retained {
        if unsafe { SetWindowRgn(hwnd, old, 1) } == 0 {
            unsafe {
                DeleteObject(old as _);
            }
        }
        unsafe {
            DeleteObject(exposed as _);
        }
        return Err(io::Error::other(
            "Windows did not retain Otto's silhouette.",
        ));
    }
    unsafe {
        InvalidateRgn(hwnd, exposed, 0);
        DeleteObject(exposed as _);
        DeleteObject(old as _);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attached() -> Shape {
        shape_for(Silhouette::Attached, 346.0, 1.0)
    }

    #[test]
    fn native_region_preserves_the_visible_curve_fringe_at_fractional_dpi() {
        for scale in [1.0, 1.5, 2.0] {
            for silhouette in [Silhouette::Capsule, Silhouette::Card, Silhouette::Attached] {
                let width = 116.0 * scale;
                let height = 54.0 * scale;
                let shape = shape_for(silhouette, height, scale);
                let region = create_region_at(shape, width, height, 0, 0).unwrap();
                for y in 0..height as i32 {
                    for x in 0..width as i32 {
                        let covered = [0.01, 0.5, 0.99].into_iter().any(|dx| {
                            [0.01, 0.5, 0.99].into_iter().any(|dy| {
                                contains(shape, width, height, f64::from(x) + dx, f64::from(y) + dy)
                            })
                        });
                        assert!(
                            !covered || region_contains(region, x, y),
                            "clipped fringe: {silhouette:?}, scale={scale}, pixel={x},{y}"
                        );
                    }
                }
                assert!(!region_contains(region, -1, height as i32 / 2));
                assert!(!region_contains(region, width as i32, height as i32 / 2));
                assert!(!region_contains(region, 0, height as i32 - 1));
                unsafe { DeleteObject(region as _) };
            }
        }
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
        for inset in [2, 4] {
            assert!(!region_contains(region, inset, inset));
            assert!(!region_contains(region, 92 - inset, inset));
            assert!(!region_contains(region, inset, 42 - inset));
            assert!(!region_contains(region, 92 - inset, 42 - inset));
        }
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
