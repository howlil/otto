use serde::Serialize;

pub const LOW_BATTERY_PERCENT: u8 = 20;
pub const CRITICAL_BATTERY_PERCENT: u8 = 10;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OsEventClass {
    Volume,
    Brightness,
    Wifi,
    Bluetooth,
    Battery,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PeripheralKind {
    Audio,
    Input,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Observation {
    Volume {
        percent: u8,
        muted: bool,
    },
    Brightness {
        percent: u8,
    },
    Wifi {
        connected: bool,
    },
    Peripheral {
        connected: bool,
        kind: PeripheralKind,
        name: Option<String>,
    },
    Power {
        plugged: bool,
        charging: bool,
        percent: Option<u8>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(
    tag = "class",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum OsEventView {
    Volume {
        id: u64,
        percent: u8,
        muted: bool,
    },
    Brightness {
        id: u64,
        percent: u8,
    },
    Wifi {
        id: u64,
        connected: bool,
    },
    Bluetooth {
        id: u64,
        connected: bool,
        kind: PeripheralKind,
        name: Option<String>,
    },
    Battery {
        id: u64,
        plugged: bool,
        charging: bool,
        percent: Option<u8>,
        low: bool,
        critical: bool,
    },
}

impl OsEventView {
    pub fn id(&self) -> u64 {
        match self {
            Self::Volume { id, .. }
            | Self::Brightness { id, .. }
            | Self::Wifi { id, .. }
            | Self::Bluetooth { id, .. }
            | Self::Battery { id, .. } => *id,
        }
    }

    pub fn class(&self) -> OsEventClass {
        match self {
            Self::Volume { .. } => OsEventClass::Volume,
            Self::Brightness { .. } => OsEventClass::Brightness,
            Self::Wifi { .. } => OsEventClass::Wifi,
            Self::Bluetooth { .. } => OsEventClass::Bluetooth,
            Self::Battery { .. } => OsEventClass::Battery,
        }
    }

    pub fn priority(&self) -> u8 {
        match self {
            Self::Battery {
                plugged,
                low,
                critical,
                ..
            } => {
                if *critical && !*plugged {
                    60
                } else if *low && !*plugged {
                    55
                } else {
                    40
                }
            }
            Self::Wifi { connected, .. } | Self::Bluetooth { connected, .. } => {
                if *connected {
                    25
                } else {
                    30
                }
            }
            Self::Volume { .. } | Self::Brightness { .. } => 10,
        }
    }
}

pub trait EventSink: Send + Sync {
    fn observe(&self, observation: Observation);
}

pub fn sanitize_name(raw: Option<&str>) -> Option<String> {
    let raw = raw?;
    let mut cleaned = String::new();
    let mut pending_space = false;
    for character in raw.chars() {
        if character.is_control() || is_bidi_control(character) {
            continue;
        }
        if character.is_whitespace() {
            pending_space = !cleaned.is_empty();
            continue;
        }
        if pending_space {
            cleaned.push(' ');
            pending_space = false;
        }
        if cleaned.chars().count() >= 40 {
            break;
        }
        cleaned.push(character);
    }
    let cleaned = cleaned.trim().to_string();
    (!cleaned.is_empty()).then_some(cleaned)
}

fn is_bidi_control(character: char) -> bool {
    matches!(character, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}' | '\u{200e}' | '\u{200f}')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_device_names_without_control_or_bidi_characters() {
        assert_eq!(
            sanitize_name(Some("  WH-1000XM5\u{202e}\n  ")),
            Some("WH-1000XM5".to_string())
        );
        assert_eq!(
            sanitize_name(Some("Blue\u{0}tooth\u{1f}   Headset")),
            Some("Bluetooth Headset".to_string())
        );
        assert_eq!(sanitize_name(Some("   ")), None);
        assert_eq!(sanitize_name(None), None);
    }

    #[test]
    fn caps_device_names_and_never_emits_partial_utf8() {
        let long = "é".repeat(64);
        let sanitized = sanitize_name(Some(&long)).unwrap();
        assert_eq!(sanitized.chars().count(), 40);
        assert!(sanitized.is_char_boundary(sanitized.len()));
    }

    #[test]
    fn serializes_the_ipc_contract_with_camel_case_fields() {
        let battery = serde_json::to_value(OsEventView::Battery {
            id: 7,
            plugged: true,
            charging: true,
            percent: Some(82),
            low: false,
            critical: false,
        })
        .unwrap();
        assert_eq!(battery["class"], "battery");
        assert_eq!(battery["id"], 7);
        assert_eq!(battery["plugged"], true);
        assert_eq!(battery["charging"], true);

        let peripheral = serde_json::to_value(OsEventView::Bluetooth {
            id: 8,
            connected: true,
            kind: PeripheralKind::Audio,
            name: Some("Headset".to_string()),
        })
        .unwrap();
        assert_eq!(peripheral["class"], "bluetooth");
        assert_eq!(peripheral["kind"], "audio");
    }

    #[test]
    fn battery_priority_outranks_connectivity_and_levels() {
        let critical = OsEventView::Battery {
            id: 1,
            plugged: false,
            charging: false,
            percent: Some(8),
            low: true,
            critical: true,
        };
        let disconnected = OsEventView::Wifi {
            id: 1,
            connected: false,
        };
        let volume = OsEventView::Volume {
            id: 1,
            percent: 50,
            muted: false,
        };
        assert!(critical.priority() > disconnected.priority());
        assert!(disconnected.priority() > volume.priority());
    }
}
