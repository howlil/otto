#[cfg(test)]
pub const SHOULDER: f64 = 12.0;
#[cfg(test)]
pub const ATTACHED_RADIUS: f64 = 18.0;
#[cfg(test)]
pub const CARD_RADIUS: f64 = 18.0;
#[cfg(test)]
pub const COMPACT_RADIUS: f64 = 13.0;
#[cfg(test)]
const ARC_SEGMENTS: usize = 10;

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Silhouette {
    Capsule,
    Card,
    Attached,
}

#[cfg(test)]
impl Silhouette {
    pub(crate) fn parse(value: &str) -> Result<Self, String> {
        match value {
            "capsule" => Ok(Self::Capsule),
            "card" => Ok(Self::Card),
            "attached" => Ok(Self::Attached),
            _ => Err("Unknown notch silhouette.".to_string()),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Shape {
    pub(crate) top: f64,
    pub(crate) bottom: f64,
    pub(crate) gutter: f64,
}

impl Shape {
    #[cfg(test)]
    pub(crate) fn attached(self) -> bool {
        self.gutter > 0.5
    }
}

#[cfg(test)]
pub(crate) fn shape_for(silhouette: Silhouette, height: f64, scale: f64) -> Shape {
    let limit = (height / 2.0).max(0.0);
    match silhouette {
        Silhouette::Capsule => Shape {
            top: (COMPACT_RADIUS * scale).min(limit),
            bottom: (COMPACT_RADIUS * scale).min(limit),
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

pub(crate) fn shoulder_extension(gutter: f64, y: f64) -> f64 {
    if gutter <= 0.0 || y < 0.0 || y >= gutter {
        return 0.0;
    }
    let drop = gutter - y;
    gutter - (gutter * gutter - drop * drop).max(0.0).sqrt()
}

fn inside_corner(dx: f64, dy: f64, radius: f64) -> bool {
    dx * dx + dy * dy <= radius * radius
}

pub(crate) fn contains(shape: Shape, width: f64, height: f64, x: f64, y: f64) -> bool {
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
pub(crate) fn polygon(shape: Shape, width: f64, height: f64) -> Vec<(f64, f64)> {
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
