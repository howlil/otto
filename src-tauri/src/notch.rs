pub const MAX_TOP_OFFSET: u32 = 64;

pub fn surface_layouts() -> std::collections::BTreeMap<&'static str, (u32, u32)> {
    [
        ("idle", (92, 42)),
        ("agentCompact", (228, 50)),
        ("musicCompact", (264, 54)),
        ("musicPlayer", (444, 178)),
        ("musicLyrics", (444, 212)),
        ("focusCompact", (224, 52)),
        ("focus", (408, 174)),
        ("focusSettings", (408, 328)),
        ("home", (452, 148)),
        ("homeSettings", (452, 314)),
        ("agentReady", (526, 170)),
        ("agentThinking", (526, 236)),
        ("agentFull", (526, 346)),
        ("agentError", (526, 270)),
        ("agentSettings", (526, 466)),
        ("osEvent", (234, 52)),
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
    let y = i64::from(monitor.y) + inset;
    let available = (bottom - y - (16.0 * scale).round() as i64).max(1) as u32;
    let height = ((f64::from(capacity.1) * scale).round() as u32)
        .min(available)
        .max(1);
    Ok(RectPx {
        x: monitor.x + ((monitor.width - width) / 2) as i32,
        y: y as i32,
        width,
        height,
    })
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
    }

    #[test]
    fn host_capacity_is_monitor_bounded_and_attached_ignores_floating_offset() {
        let monitor = RectPx {
            x: -1920,
            y: -240,
            width: 1920,
            height: 1080,
        };
        let floating = host_bounds(monitor, 800, 1.5, (550, 610), false, 20).unwrap();
        assert_eq!(
            floating,
            RectPx {
                x: -1373,
                y: -210,
                width: 825,
                height: 915
            }
        );
        let attached = host_bounds(monitor, 200, 1.5, (550, 610), true, 64).unwrap();
        assert_eq!(attached.y, -240);
        assert_eq!(attached.height, 416);
        assert!(host_bounds(monitor, 800, 0.0, (550, 610), false, 20).is_err());
    }
}
