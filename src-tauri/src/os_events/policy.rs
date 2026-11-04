use super::model::{Observation, OsEventView, PeripheralKind, sanitize_name};
use std::time::Instant;

pub const EVENT_TTL_MS: u64 = 2_200;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PowerState {
    plugged: bool,
    charging: bool,
    percent: Option<u8>,
    low: bool,
    critical: bool,
}

impl PowerState {
    fn from_observation(plugged: bool, charging: bool, percent: Option<u8>) -> Self {
        let usable = percent.filter(|_| !plugged);
        Self {
            plugged,
            charging: plugged && charging,
            percent,
            low: usable.is_some_and(|value| value <= super::model::LOW_BATTERY_PERCENT),
            critical: usable.is_some_and(|value| value <= super::model::CRITICAL_BATTERY_PERCENT),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
struct Active {
    view: OsEventView,
    expires_at: u64,
}

#[derive(Default)]
pub struct Hub {
    started: Option<Instant>,
    next_id: u64,
    current: Option<Active>,
    power: Option<PowerState>,
    last_volume: Option<(u8, bool)>,
    last_brightness: Option<u8>,
    last_wifi: Option<bool>,
    last_peripheral: Option<(Option<String>, bool, PeripheralKind)>,
    announced_low: bool,
    announced_critical: bool,
}

impl Hub {
    pub fn clear_current(&mut self) {
        self.current = None;
    }

    pub fn current(&mut self) -> Option<OsEventView> {
        let now = self.now_ms();
        self.current_at(now)
    }

    pub fn current_at(&self, now_ms: u64) -> Option<OsEventView> {
        match &self.current {
            Some(active) if active.expires_at > now_ms => Some(active.view.clone()),
            _ => None,
        }
    }

    pub fn observe_now(&mut self, observation: Observation) -> Option<OsEventView> {
        let now = self.now_ms();
        self.observe(now, observation)
    }

    pub fn observe(&mut self, now_ms: u64, observation: Observation) -> Option<OsEventView> {
        let candidate = self.candidate(observation)?;
        let class = candidate.class();
        let publish = match &self.current {
            Some(active) if active.expires_at > now_ms => {
                active.view.class() == class || candidate.priority() > active.view.priority()
            }
            _ => true,
        };
        if !publish {
            return None;
        }
        let reusable = self
            .current
            .as_ref()
            .filter(|active| active.expires_at > now_ms && active.view.class() == class)
            .map(|active| active.view.id());
        let id = reusable.unwrap_or_else(|| {
            self.next_id += 1;
            self.next_id
        });
        let view = with_id(candidate, id);
        self.current = Some(Active {
            view: view.clone(),
            expires_at: now_ms + EVENT_TTL_MS,
        });
        Some(view)
    }

    fn candidate(&mut self, observation: Observation) -> Option<OsEventView> {
        match observation {
            Observation::Volume { percent, muted } => {
                if self.last_volume == Some((percent, muted)) {
                    return None;
                }
                self.last_volume = Some((percent, muted));
                Some(OsEventView::Volume {
                    id: 0,
                    percent,
                    muted,
                })
            }
            Observation::Brightness { percent } => {
                if self.last_brightness == Some(percent) {
                    return None;
                }
                self.last_brightness = Some(percent);
                Some(OsEventView::Brightness { id: 0, percent })
            }
            Observation::Wifi { connected } => {
                if self.last_wifi == Some(connected) {
                    return None;
                }
                self.last_wifi = Some(connected);
                Some(OsEventView::Wifi { id: 0, connected })
            }
            Observation::Peripheral {
                connected,
                kind,
                name,
            } => {
                let name = sanitize_name(name.as_deref());
                let key = (name.clone(), connected, kind);
                if self.last_peripheral.as_ref() == Some(&key) {
                    return None;
                }
                self.last_peripheral = Some(key);
                Some(OsEventView::Bluetooth {
                    id: 0,
                    connected,
                    kind,
                    name,
                })
            }
            Observation::Power {
                plugged,
                charging,
                percent,
            } => self.power_candidate(plugged, charging, percent),
        }
    }

    fn power_candidate(
        &mut self,
        plugged: bool,
        charging: bool,
        percent: Option<u8>,
    ) -> Option<OsEventView> {
        let next = PowerState::from_observation(plugged, charging, percent);
        let previous = self.power.replace(next);
        let Some(previous) = previous else {
            self.announced_low = next.low;
            self.announced_critical = next.critical;
            return None;
        };
        if next.plugged || (!next.low && !next.critical) {
            self.announced_low = next.low;
            self.announced_critical = next.critical;
        }
        let crossed_low = next.low && !self.announced_low;
        let crossed_critical = next.critical && !self.announced_critical;
        let power_changed = previous.plugged != next.plugged || previous.charging != next.charging;
        if !power_changed && !crossed_low && !crossed_critical {
            return None;
        }
        if crossed_low {
            self.announced_low = true;
        }
        if crossed_critical {
            self.announced_critical = true;
        }
        Some(OsEventView::Battery {
            id: 0,
            plugged: next.plugged,
            charging: next.charging,
            percent: next.percent,
            low: next.low,
            critical: next.critical,
        })
    }

    fn now_ms(&mut self) -> u64 {
        let started = *self.started.get_or_insert_with(Instant::now);
        started.elapsed().as_millis() as u64
    }
}

fn with_id(view: OsEventView, id: u64) -> OsEventView {
    match view {
        OsEventView::Volume { percent, muted, .. } => OsEventView::Volume { id, percent, muted },
        OsEventView::Brightness { percent, .. } => OsEventView::Brightness { id, percent },
        OsEventView::Wifi { connected, .. } => OsEventView::Wifi { id, connected },
        OsEventView::Bluetooth {
            connected,
            kind,
            name,
            ..
        } => OsEventView::Bluetooth {
            id,
            connected,
            kind,
            name,
        },
        OsEventView::Battery {
            plugged,
            charging,
            percent,
            low,
            critical,
            ..
        } => OsEventView::Battery {
            id,
            plugged,
            charging,
            percent,
            low,
            critical,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::os_events::model::OsEventClass;

    fn volume(percent: u8) -> Observation {
        Observation::Volume {
            percent,
            muted: false,
        }
    }

    fn power(plugged: bool, charging: bool, percent: u8) -> Observation {
        Observation::Power {
            plugged,
            charging,
            percent: Some(percent),
        }
    }

    #[test]
    fn seeds_battery_state_without_a_startup_capsule() {
        let mut hub = Hub::default();
        assert_eq!(hub.observe(0, power(false, false, 80)), None);
        assert_eq!(hub.observe(1_000, power(false, false, 79)), None);
    }

    #[test]
    fn dedupes_identical_levels_and_refreshes_the_same_event_id() {
        let mut hub = Hub::default();
        let first = hub.observe(0, volume(40)).unwrap();
        assert!(hub.observe(100, volume(40)).is_none());
        let second = hub.observe(200, volume(41)).unwrap();
        assert_eq!(first.id(), second.id());
    }

    #[test]
    fn lower_priority_events_are_dropped_while_a_capsule_is_active() {
        let mut hub = Hub::default();
        assert!(hub.observe(0, power(false, false, 80)).is_none());
        let low = hub.observe(100, power(false, false, 15)).unwrap();
        assert_eq!(low.class(), OsEventClass::Battery);
        assert!(hub.observe(500, volume(60)).is_none());
        assert!(hub.observe(2_299, volume(61)).is_none());
        let after = hub.observe(2_301, volume(62)).unwrap();
        assert_eq!(after.class(), OsEventClass::Volume);
    }

    #[test]
    fn same_class_battery_transition_replaces_critical_with_charging() {
        let mut hub = Hub::default();
        assert!(hub.observe(0, power(false, false, 80)).is_none());
        let critical = hub.observe(1_000, power(false, false, 9)).unwrap();
        let charging = hub.observe(1_400, power(true, true, 9)).unwrap();
        assert_eq!(charging.class(), OsEventClass::Battery);
        assert_eq!(critical.id(), charging.id());
        match charging {
            OsEventView::Battery {
                plugged,
                charging,
                low,
                critical,
                ..
            } => {
                assert!(plugged);
                assert!(charging);
                assert!(!low);
                assert!(!critical);
            }
            _ => panic!("expected battery view"),
        }
    }

    #[test]
    fn reports_plugged_in_without_claiming_charging() {
        let mut hub = Hub::default();
        assert!(hub.observe(0, power(false, false, 100)).is_none());
        let plugged = hub.observe(1_000, power(true, false, 100)).unwrap();
        match plugged {
            OsEventView::Battery {
                plugged, charging, ..
            } => {
                assert!(plugged);
                assert!(!charging);
            }
            _ => panic!("expected battery view"),
        }
    }

    #[test]
    fn announces_low_and_critical_once_per_discharge_cycle() {
        let mut hub = Hub::default();
        assert!(hub.observe(0, power(false, false, 80)).is_none());
        assert_eq!(
            hub.observe(1_000, power(false, false, 20))
                .map(|v| v.class()),
            Some(OsEventClass::Battery)
        );
        assert!(hub.observe(1_100, power(false, false, 19)).is_none());
        assert!(hub.observe(1_200, power(false, false, 11)).is_none());
        assert_eq!(
            hub.observe(1_300, power(false, false, 10))
                .map(|v| v.class()),
            Some(OsEventClass::Battery)
        );
        assert!(hub.observe(1_400, power(false, false, 9)).is_none());
        assert_eq!(
            hub.observe(1_500, power(true, true, 9)).map(|v| v.class()),
            Some(OsEventClass::Battery)
        );
        assert_eq!(
            hub.observe(1_900, power(false, false, 25))
                .map(|v| v.class()),
            Some(OsEventClass::Battery)
        );
    }

    #[test]
    fn wifi_disconnect_preempts_volume_and_connectivity_dedupes() {
        let mut hub = Hub::default();
        assert!(hub.observe(0, volume(30)).is_some());
        let disconnect = hub
            .observe(100, Observation::Wifi { connected: false })
            .unwrap();
        assert_eq!(disconnect.class(), OsEventClass::Wifi);
        assert!(
            hub.observe(200, Observation::Wifi { connected: false })
                .is_none()
        );
    }

    #[test]
    fn peripheral_events_require_a_real_transition_and_sanitize_names() {
        let mut hub = Hub::default();
        let first = hub
            .observe(
                0,
                Observation::Peripheral {
                    connected: true,
                    kind: PeripheralKind::Audio,
                    name: Some("  Headset\u{202e} ".to_string()),
                },
            )
            .unwrap();
        match first {
            OsEventView::Bluetooth { name, .. } => assert_eq!(name.as_deref(), Some("Headset")),
            _ => panic!("expected peripheral view"),
        }
        assert!(
            hub.observe(
                100,
                Observation::Peripheral {
                    connected: true,
                    kind: PeripheralKind::Audio,
                    name: Some("Headset".to_string()),
                }
            )
            .is_none()
        );
        assert!(
            hub.observe(
                200,
                Observation::Peripheral {
                    connected: false,
                    kind: PeripheralKind::Audio,
                    name: Some("Headset".to_string()),
                }
            )
            .is_some()
        );
    }

    #[test]
    fn expired_events_are_not_replayed_to_a_new_subscriber() {
        let mut hub = Hub::default();
        assert!(hub.observe(0, volume(50)).is_some());
        assert_eq!(
            hub.current_at(2_199).map(|view| view.class()),
            Some(OsEventClass::Volume)
        );
        assert_eq!(hub.current_at(2_200).map(|view| view.class()), None);
    }
}
