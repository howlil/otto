pub const MAX_TOP_OFFSET: u32 = 64;

pub fn surface_layouts() -> std::collections::BTreeMap<&'static str, (u32, u32)> {
    [
        ("agentCompact", (228, 40)),
        ("agentCompactCircle", (40, 40)),
        ("agentReady", (526, 170)),
        ("agentThinking", (526, 236)),
        ("agentFull", (526, 346)),
        ("agentError", (526, 270)),
        ("settings", (526, 420)),
    ]
    .into()
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct RectPx {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HorizontalAnchor {
    Left,
    #[default]
    Center,
    Right,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum VerticalAnchor {
    #[default]
    Top,
    Bottom,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostAnchor {
    pub horizontal: HorizontalAnchor,
    pub vertical: VerticalAnchor,
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionPx {
    pub x: i32,
    pub y: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor_x: Option<HorizontalAnchor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor_y: Option<VerticalAnchor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
}

impl PositionPx {
    pub fn plain(x: i32, y: i32) -> Self {
        Self {
            x,
            y,
            anchor_x: None,
            anchor_y: None,
            height: None,
        }
    }

    pub fn anchored(bounds: RectPx, anchor: HostAnchor) -> Self {
        Self {
            x: bounds.x,
            y: bounds.y,
            anchor_x: Some(anchor.horizontal),
            anchor_y: Some(anchor.vertical),
            height: Some(bounds.height),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct RadiusPx {
    pub top: u32,
    pub bottom: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionPx {
    pub host_revision: u32,
    pub sequence: u32,
    pub body: RectPx,
    pub radius: RadiusPx,
    pub shoulder: u32,
    #[serde(default)]
    pub morph: bool,
}

impl RegionPx {
    pub fn validate(&self, host: (u32, u32)) -> Result<(), String> {
        let body = self.body;
        let right = i64::from(body.x) + i64::from(body.width) + i64::from(self.shoulder);
        let bottom = i64::from(body.y) + i64::from(body.height);
        if body.width == 0
            || body.height == 0
            || i64::from(body.x) < i64::from(self.shoulder)
            || body.y < 0
            || right > i64::from(host.0)
            || bottom > i64::from(host.1)
            || self.radius.top > body.width.min(body.height) / 2
            || self.radius.bottom > body.width.min(body.height) / 2
            || self.shoulder > body.height
            || (self.shoulder > 0 && self.radius.top > 0)
        {
            return Err("Notch region is outside the configured host.".into());
        }
        Ok(())
    }

    pub fn same_shape(&self, previous: &Self) -> bool {
        self.body == previous.body
            && self.radius == previous.radius
            && self.shoulder == previous.shoulder
            && self.morph == previous.morph
    }
}

#[derive(Default)]
pub struct RegionOrder {
    pub revision: u32,
    pub sequence: u32,
}

impl RegionOrder {
    pub fn accepts(&self, region: &RegionPx) -> bool {
        region.host_revision == self.revision && region.sequence > self.sequence
    }
}

pub fn host_bounds(
    monitor: RectPx,
    bottom: i64,
    scale: f64,
    capacity: (u32, u32),
    attached: bool,
    top_offset: u32,
    position: Option<PositionPx>,
) -> Result<RectPx, String> {
    if !scale.is_finite()
        || scale <= 0.0
        || top_offset > MAX_TOP_OFFSET
        || capacity.0 == 0
        || capacity.1 == 0
        || capacity.0 > 8192
        || capacity.1 > 8192
    {
        return Err("Invalid notch host geometry.".into());
    }
    let width = ((f64::from(capacity.0) * scale).round() as u32)
        .min(monitor.width)
        .max(1);
    let inset = if attached {
        0
    } else {
        (f64::from(top_offset) * scale).round() as i64
    };
    let custom_position = position.is_some();
    let (x, y) = position
        .map(|position| (position.x, i64::from(position.y)))
        .unwrap_or((
            monitor.x + ((monitor.width - width) / 2) as i32,
            i64::from(monitor.y) + inset,
        ));
    let height = if custom_position {
        ((f64::from(capacity.1) * scale).round() as u32)
            .min(monitor.height)
            .max(1)
    } else {
        let available = (bottom - y - (16.0 * scale).round() as i64).max(1) as u32;
        ((f64::from(capacity.1) * scale).round() as u32)
            .min(available)
            .max(1)
    };
    Ok(RectPx {
        x,
        y: y as i32,
        width,
        height,
    })
}

pub fn stage_offset(host: (u32, u32), surface: (u32, u32), anchor: HostAnchor) -> (i32, i32) {
    let x = match anchor.horizontal {
        HorizontalAnchor::Left => 0,
        HorizontalAnchor::Center => (host.0.saturating_sub(surface.0) / 2) as i32,
        HorizontalAnchor::Right => host.0.saturating_sub(surface.0) as i32,
    };
    let y = match anchor.vertical {
        VerticalAnchor::Top => 0,
        VerticalAnchor::Bottom => host.1.saturating_sub(surface.1) as i32,
    };
    (x, y)
}

pub fn inferred_surface_rect(
    position: PositionPx,
    host_width: u32,
    default_host_height: u32,
    compact_size: (u32, u32),
) -> RectPx {
    let anchor = HostAnchor {
        horizontal: position.anchor_x.unwrap_or_default(),
        vertical: position.anchor_y.unwrap_or_default(),
    };
    let host_height = position.height.unwrap_or(default_host_height).max(1);
    let surface_w = compact_size.0.min(host_width).max(1);
    let surface_h = compact_size.1.min(host_height).max(1);
    let (dx, dy) = stage_offset((host_width, host_height), (surface_w, surface_h), anchor);
    RectPx {
        x: position.x.saturating_add(dx),
        y: position.y.saturating_add(dy),
        width: surface_w,
        height: surface_h,
    }
}

pub fn resolve_floating_host(
    work: RectPx,
    scale: f64,
    capacity: (u32, u32),
    surface: RectPx,
) -> Result<(RectPx, HostAnchor), String> {
    if !scale.is_finite()
        || scale <= 0.0
        || capacity.0 == 0
        || capacity.1 == 0
        || capacity.0 > 8192
        || capacity.1 > 8192
        || work.width == 0
        || work.height == 0
    {
        return Err("Invalid notch host geometry.".into());
    }
    let host_w = ((f64::from(capacity.0) * scale).round() as u32)
        .min(work.width)
        .max(1);
    let cap_h = ((f64::from(capacity.1) * scale).round() as u32)
        .min(work.height)
        .max(1);
    let work_left = i64::from(work.x);
    let work_right = work_left + i64::from(work.width);
    let work_top = i64::from(work.y);
    let work_bottom = work_top + i64::from(work.height);
    let surf_w = i64::from(surface.width.max(1)).min(i64::from(host_w));
    let surf_h = i64::from(surface.height.max(1)).min(i64::from(cap_h));
    let surf_left = i64::from(surface.x).clamp(work_left, (work_right - surf_w).max(work_left));
    let surf_top = i64::from(surface.y).clamp(work_top, (work_bottom - surf_h).max(work_top));
    let surf_right = surf_left + surf_w;
    let surf_bottom = surf_top + surf_h;
    let surf_cx = surf_left + surf_w / 2;

    let min_x = work_left;
    let max_x = (work_right - i64::from(host_w)).max(work_left);
    let centered_x = surf_cx - i64::from(host_w) / 2;
    let (horizontal, host_x) = if centered_x >= min_x && centered_x <= max_x {
        (HorizontalAnchor::Center, centered_x)
    } else if centered_x > max_x {
        (
            HorizontalAnchor::Right,
            (surf_right - i64::from(host_w)).clamp(min_x, max_x),
        )
    } else {
        (HorizontalAnchor::Left, surf_left.clamp(min_x, max_x))
    };

    let space_below = (work_bottom - surf_top).max(0);
    let space_above = (surf_bottom - work_top).max(0);
    let (vertical, host_y, host_h) =
        if space_below >= i64::from(cap_h) || space_below >= space_above {
            let h = i64::from(cap_h)
                .min(space_below)
                .max(surf_h)
                .min(i64::from(work.height));
            let y = surf_top.clamp(work_top, (work_bottom - h).max(work_top));
            (VerticalAnchor::Top, y, h as u32)
        } else {
            let h = i64::from(cap_h)
                .min(space_above)
                .max(surf_h)
                .min(i64::from(work.height));
            let y = (surf_bottom - h).clamp(work_top, (work_bottom - h).max(work_top));
            (VerticalAnchor::Bottom, y, h as u32)
        };

    Ok((
        RectPx {
            x: host_x as i32,
            y: host_y as i32,
            width: host_w,
            height: host_h,
        },
        HostAnchor {
            horizontal,
            vertical,
        },
    ))
}

#[cfg(any(test, windows))]
pub fn shifted_region(region: RegionPx, from: RectPx, to: RectPx) -> Option<RegionPx> {
    let dx = i64::from(from.x) - i64::from(to.x);
    let dy = i64::from(from.y) - i64::from(to.y);
    let width = region.body.width.min(to.width);
    let height = region.body.height.min(to.height);
    if width == 0 || height == 0 {
        return None;
    }
    let min_x = i64::from(region.shoulder);
    let max_x = (i64::from(to.width) - i64::from(width) - i64::from(region.shoulder)).max(min_x);
    let max_y = (i64::from(to.height) - i64::from(height)).max(0);
    let x = (i64::from(region.body.x) + dx).clamp(min_x, max_x) as i32;
    let y = (i64::from(region.body.y) + dy).clamp(0, max_y) as i32;
    let limit = width.min(height) / 2;
    let next = RegionPx {
        body: RectPx {
            x,
            y,
            width,
            height,
        },
        radius: RadiusPx {
            top: region.radius.top.min(limit),
            bottom: region.radius.bottom.min(limit),
        },
        morph: false,
        ..region
    };
    next.validate((to.width, to.height)).ok()?;
    Some(next)
}

pub fn rect_distance_sq(rect: RectPx, x: i64, y: i64) -> i64 {
    let left = i64::from(rect.x);
    let right = left + i64::from(rect.width);
    let top = i64::from(rect.y);
    let bottom = top + i64::from(rect.height);
    let dx = if x < left {
        left - x
    } else if x > right {
        x - right
    } else {
        0
    };
    let dy = if y < top {
        top - y
    } else if y > bottom {
        y - bottom
    } else {
        0
    };
    dx * dx + dy * dy
}

pub fn resolve_surface_rect(
    position: PositionPx,
    surface_rect: Option<RectPx>,
    host_width: u32,
    default_host_height: u32,
    compact_logical: (u32, u32),
    scale: f64,
) -> RectPx {
    match surface_rect {
        Some(rect) => RectPx {
            x: position.x.saturating_add(rect.x),
            y: position.y.saturating_add(rect.y),
            width: rect.width.max(1),
            height: rect.height.max(1),
        },
        None => {
            let compact_px = (
                (f64::from(compact_logical.0) * scale).round().max(1.0) as u32,
                (f64::from(compact_logical.1) * scale).round().max(1.0) as u32,
            );
            inferred_surface_rect(position, host_width, default_host_height, compact_px)
        }
    }
}

pub fn surface_probe_center(
    position: PositionPx,
    surface_rect: Option<RectPx>,
    capacity: (u32, u32),
    compact_circle: bool,
) -> (i64, i64) {
    let rect = match surface_rect {
        Some(rect) => RectPx {
            x: position.x.saturating_add(rect.x),
            y: position.y.saturating_add(rect.y),
            width: rect.width.max(1),
            height: rect.height.max(1),
        },
        None => {
            let compact = if compact_circle { (40, 40) } else { (228, 40) };
            inferred_surface_rect(
                position,
                capacity.0,
                position.height.unwrap_or(capacity.1),
                compact,
            )
        }
    };
    (
        i64::from(rect.x) + i64::from(rect.width) / 2,
        i64::from(rect.y) + i64::from(rect.height) / 2,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn region() -> RegionPx {
        RegionPx {
            host_revision: 3,
            sequence: 8,
            body: RectPx {
                x: 100,
                y: 0,
                width: 300,
                height: 80,
            },
            radius: RadiusPx {
                top: 27,
                bottom: 27,
            },
            shoulder: 0,
            morph: false,
        }
    }

    #[test]
    fn stale_host_and_reordered_frames_cannot_replace_the_current_region() {
        let order = RegionOrder {
            revision: 3,
            sequence: 8,
        };
        assert!(!order.accepts(&region()));
        assert!(!order.accepts(&RegionPx {
            sequence: 7,
            ..region()
        }));
        assert!(!order.accepts(&RegionPx {
            host_revision: 2,
            sequence: 100,
            ..region()
        }));
        assert!(order.accepts(&RegionPx {
            sequence: 9,
            ..region()
        }));
    }

    #[test]
    fn region_bounds_include_both_shoulders_and_reject_invalid_radii() {
        assert!(region().validate((550, 610)).is_ok());
        let attached = RegionPx {
            shoulder: 12,
            radius: RadiusPx { top: 0, bottom: 24 },
            ..region()
        };
        assert!(attached.validate((550, 610)).is_ok());
        assert!(
            RegionPx {
                body: RectPx {
                    x: 0,
                    ..attached.body
                },
                ..attached
            }
            .validate((550, 610))
            .is_err()
        );
        assert!(
            RegionPx {
                body: RectPx {
                    width: 500,
                    ..attached.body
                },
                ..attached
            }
            .validate((550, 610))
            .is_err()
        );
        assert!(
            RegionPx {
                radius: RadiusPx { top: 41, bottom: 0 },
                ..region()
            }
            .validate((550, 610))
            .is_err()
        );
        assert!(
            RegionPx {
                body: RectPx {
                    height: 0,
                    ..region().body
                },
                ..region()
            }
            .validate((550, 610))
            .is_err()
        );
    }

    #[test]
    fn deduplication_includes_position_radius_and_shoulders() {
        assert!(region().same_shape(&RegionPx {
            sequence: 9,
            ..region()
        }));
        assert!(!region().same_shape(&RegionPx {
            body: RectPx {
                x: 101,
                ..region().body
            },
            ..region()
        }));
        assert!(!region().same_shape(&RegionPx {
            radius: RadiusPx {
                top: 26,
                bottom: 27
            },
            ..region()
        }));
        assert!(!region().same_shape(&RegionPx {
            morph: true,
            ..region()
        }));
    }

    #[test]
    fn host_capacity_is_monitor_bounded_and_attached_ignores_floating_offset() {
        let monitor = RectPx {
            x: -1920,
            y: -240,
            width: 1920,
            height: 1080,
        };
        let floating = host_bounds(monitor, 800, 1.5, (550, 610), false, 20, None).unwrap();
        assert_eq!(
            floating,
            RectPx {
                x: -1373,
                y: -210,
                width: 825,
                height: 915
            }
        );
        let attached = host_bounds(monitor, 200, 1.5, (550, 610), true, 64, None).unwrap();
        assert_eq!(attached.y, -240);
        assert_eq!(attached.height, 416);
        assert!(host_bounds(monitor, 800, 0.0, (550, 610), false, 20, None).is_err());
    }

    #[test]
    fn host_position_uses_saved_coordinates_without_changing_capacity() {
        let monitor = RectPx {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let bounds = host_bounds(
            monitor,
            1080,
            1.0,
            (550, 610),
            false,
            20,
            Some(PositionPx::plain(144, 320)),
        )
        .unwrap();
        assert_eq!(
            bounds,
            RectPx {
                x: 144,
                y: 320,
                width: 550,
                height: 610
            }
        );
        let low = host_bounds(
            monitor,
            1080,
            1.0,
            (550, 610),
            false,
            20,
            Some(PositionPx::plain(144, 800)),
        )
        .unwrap();
        assert_eq!(low.height, 610);
    }

    #[test]
    fn floating_host_expands_opposite_the_nearest_screen_edges_without_overflow() {
        let work = RectPx {
            x: 0,
            y: 0,
            width: 1920,
            height: 1040,
        };
        let assert_fits = |bounds: RectPx, surface: RectPx, anchor: HostAnchor| {
            assert!(bounds.x >= work.x);
            assert!(bounds.y >= work.y);
            assert!(bounds.x + bounds.width as i32 <= work.x + work.width as i32);
            assert!(bounds.y + bounds.height as i32 <= work.y + work.height as i32);
            let (dx, dy) = stage_offset(
                (bounds.width, bounds.height),
                (surface.width, surface.height),
                anchor,
            );
            assert_eq!(bounds.x + dx, surface.x);
            assert_eq!(bounds.y + dy, surface.y);
        };

        let bottom_right = RectPx {
            x: 1860,
            y: 980,
            width: 40,
            height: 40,
        };
        let (bounds, anchor) = resolve_floating_host(work, 1.0, (550, 610), bottom_right).unwrap();
        assert_eq!(
            anchor,
            HostAnchor {
                horizontal: HorizontalAnchor::Right,
                vertical: VerticalAnchor::Bottom
            }
        );
        assert_fits(bounds, bottom_right, anchor);

        let bottom_left = RectPx {
            x: 20,
            y: 980,
            width: 40,
            height: 40,
        };
        let (bounds, anchor) = resolve_floating_host(work, 1.0, (550, 610), bottom_left).unwrap();
        assert_eq!(
            anchor,
            HostAnchor {
                horizontal: HorizontalAnchor::Left,
                vertical: VerticalAnchor::Bottom
            }
        );
        assert_fits(bounds, bottom_left, anchor);

        let bottom_center = RectPx {
            x: 940,
            y: 980,
            width: 40,
            height: 40,
        };
        let (bounds, anchor) = resolve_floating_host(work, 1.0, (550, 610), bottom_center).unwrap();
        assert_eq!(
            anchor,
            HostAnchor {
                horizontal: HorizontalAnchor::Center,
                vertical: VerticalAnchor::Bottom
            }
        );
        assert_fits(bounds, bottom_center, anchor);

        let top_right = RectPx {
            x: 1860,
            y: 20,
            width: 40,
            height: 40,
        };
        let (bounds, anchor) = resolve_floating_host(work, 1.0, (550, 610), top_right).unwrap();
        assert_eq!(
            anchor,
            HostAnchor {
                horizontal: HorizontalAnchor::Right,
                vertical: VerticalAnchor::Top
            }
        );
        assert_fits(bounds, top_right, anchor);

        let top_left = RectPx {
            x: 20,
            y: 20,
            width: 40,
            height: 40,
        };
        let (bounds, anchor) = resolve_floating_host(work, 1.0, (550, 610), top_left).unwrap();
        assert_eq!(
            anchor,
            HostAnchor {
                horizontal: HorizontalAnchor::Left,
                vertical: VerticalAnchor::Top
            }
        );
        assert_fits(bounds, top_left, anchor);

        let top_center = RectPx {
            x: 940,
            y: 20,
            width: 40,
            height: 40,
        };
        let (bounds, anchor) = resolve_floating_host(work, 1.0, (550, 610), top_center).unwrap();
        assert_eq!(
            anchor,
            HostAnchor {
                horizontal: HorizontalAnchor::Center,
                vertical: VerticalAnchor::Top
            }
        );
        assert_fits(bounds, top_center, anchor);
    }

    #[test]
    fn floating_host_roundtrips_saved_anchored_positions_and_heals_legacy_overflow() {
        let work = RectPx {
            x: 0,
            y: 48,
            width: 1920,
            height: 992,
        };
        let mid_low = RectPx {
            x: 940,
            y: 580,
            width: 40,
            height: 40,
        };
        let (bounds, anchor) = resolve_floating_host(work, 1.0, (550, 610), mid_low).unwrap();
        assert_eq!(anchor.vertical, VerticalAnchor::Bottom);
        assert!(bounds.height < 610);
        let saved = PositionPx::anchored(bounds, anchor);
        let restored = inferred_surface_rect(saved, 550, 610, (40, 40));
        assert_eq!(restored, mid_low);
        let (re_bounds, re_anchor) =
            resolve_floating_host(work, 1.0, (550, 610), restored).unwrap();
        assert_eq!(re_bounds, bounds);
        assert_eq!(re_anchor, anchor);

        let legacy_overflow = PositionPx::plain(1600, 960);
        let legacy_surface = inferred_surface_rect(legacy_overflow, 550, 610, (40, 40));
        let (healed, healed_anchor) =
            resolve_floating_host(work, 1.0, (550, 610), legacy_surface).unwrap();
        assert_eq!(
            healed_anchor,
            HostAnchor {
                horizontal: HorizontalAnchor::Right,
                vertical: VerticalAnchor::Bottom
            }
        );
        assert!(healed.x + healed.width as i32 <= work.x + work.width as i32);
        assert!(healed.y + healed.height as i32 <= work.y + work.height as i32);
    }

    #[test]
    fn shifted_region_keeps_the_visible_silhouette_at_the_same_screen_location() {
        let from = RectPx {
            x: 1605,
            y: 970,
            width: 550,
            height: 610,
        };
        let to = RectPx {
            x: 1350,
            y: 400,
            width: 550,
            height: 610,
        };
        let current = RegionPx {
            host_revision: 1,
            sequence: 2,
            body: RectPx {
                x: 255,
                y: 0,
                width: 40,
                height: 40,
            },
            radius: RadiusPx {
                top: 20,
                bottom: 20,
            },
            shoulder: 0,
            morph: false,
        };
        let shifted = shifted_region(current, from, to).unwrap();
        assert_eq!(
            shifted.body,
            RectPx {
                x: 510,
                y: 570,
                width: 40,
                height: 40
            }
        );
    }
}
