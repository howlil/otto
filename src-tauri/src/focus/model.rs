use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

pub(crate) const MIN_DURATION_MINUTES: u16 = 1;
pub(crate) const MAX_DURATION_MINUTES: u16 = 120;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TimerPhase {
    Focus,
    Short,
    Long,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TimerStatus {
    Ready,
    Running,
    Paused,
    Completed,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerDurations {
    pub focus: u16,
    pub short: u16,
    pub long: u16,
}

impl Default for TimerDurations {
    fn default() -> Self {
        Self {
            focus: 25,
            short: 5,
            long: 15,
        }
    }
}

impl TimerDurations {
    fn validate(&self) -> Result<(), String> {
        for (name, duration) in [
            ("Focus", self.focus),
            ("Short break", self.short),
            ("Long break", self.long),
        ] {
            if !(MIN_DURATION_MINUTES..=MAX_DURATION_MINUTES).contains(&duration) {
                return Err(format!(
                    "{name} duration must be between {MIN_DURATION_MINUTES} and {MAX_DURATION_MINUTES} minutes."
                ));
            }
        }
        Ok(())
    }

    fn seconds_for(&self, phase: TimerPhase) -> u32 {
        let minutes = match phase {
            TimerPhase::Focus => self.focus,
            TimerPhase::Short => self.short,
            TimerPhase::Long => self.long,
        };
        u32::from(minutes) * 60
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerSnapshot {
    pub revision: u64,
    pub phase: TimerPhase,
    pub status: TimerStatus,
    pub remaining_seconds: u32,
    pub durations: TimerDurations,
    pub completed_focus_sessions: u32,
}

pub(crate) struct FocusTimerState {
    phase: TimerPhase,
    status: TimerStatus,
    durations: TimerDurations,
    remaining_duration: Duration,
    deadline: Option<Instant>,
    completed_focus_sessions: u32,
    revision: u64,
}

impl Default for FocusTimerState {
    fn default() -> Self {
        let durations = TimerDurations::default();
        Self {
            phase: TimerPhase::Focus,
            status: TimerStatus::Ready,
            remaining_duration: Duration::from_secs(u64::from(
                durations.seconds_for(TimerPhase::Focus),
            )),
            durations,
            deadline: None,
            completed_focus_sessions: 0,
            revision: 0,
        }
    }
}

impl FocusTimerState {
    pub(crate) fn start(&mut self, now: Instant) -> Result<bool, String> {
        let changed = self.refresh(now);
        match self.status {
            TimerStatus::Completed => Err("Start the next phase after completion.".into()),
            TimerStatus::Running => Ok(changed),
            TimerStatus::Ready | TimerStatus::Paused => {
                self.status = TimerStatus::Running;
                self.deadline = Some(now + self.remaining_duration);
                self.revision += 1;
                Ok(true)
            }
        }
    }

    pub(crate) fn pause(&mut self, now: Instant) -> Result<bool, String> {
        self.refresh(now);
        if self.status != TimerStatus::Running {
            return Err("No timer is running.".into());
        }
        self.status = TimerStatus::Paused;
        self.deadline = None;
        self.revision += 1;
        Ok(true)
    }

    pub(crate) fn reset(&mut self, now: Instant) -> bool {
        let changed = self.refresh(now);
        let remaining_duration =
            Duration::from_secs(u64::from(self.durations.seconds_for(self.phase)));
        if self.status == TimerStatus::Ready
            && self.deadline.is_none()
            && self.remaining_duration == remaining_duration
        {
            return changed;
        }
        self.status = TimerStatus::Ready;
        self.deadline = None;
        self.remaining_duration = remaining_duration;
        self.revision += 1;
        true
    }

    pub(crate) fn configure(
        &mut self,
        durations: TimerDurations,
        now: Instant,
    ) -> Result<bool, String> {
        durations.validate()?;
        let changed = self.refresh(now);
        if self.durations == durations {
            return Ok(changed);
        }
        let previous_duration =
            Duration::from_secs(u64::from(self.durations.seconds_for(self.phase)));
        self.durations = durations;
        if self.status == TimerStatus::Ready && self.remaining_duration == previous_duration {
            self.remaining_duration =
                Duration::from_secs(u64::from(self.durations.seconds_for(self.phase)));
        }
        self.revision += 1;
        Ok(true)
    }

    pub(crate) fn select_phase(
        &mut self,
        phase: TimerPhase,
        discard_active: bool,
        now: Instant,
    ) -> Result<bool, String> {
        let changed = self.refresh(now);
        if phase == self.phase {
            return Ok(changed);
        }
        if matches!(self.status, TimerStatus::Running | TimerStatus::Paused) && !discard_active {
            return Err("Confirm switching phases to discard the active session.".into());
        }
        self.phase = phase;
        self.status = TimerStatus::Ready;
        self.deadline = None;
        self.remaining_duration = Duration::from_secs(u64::from(self.durations.seconds_for(phase)));
        self.revision += 1;
        Ok(true)
    }

    pub(crate) fn start_next(&mut self, now: Instant) -> Result<bool, String> {
        self.refresh(now);
        if self.status != TimerStatus::Completed {
            return Err("Complete the current phase before starting the next one.".into());
        }
        self.phase = match self.phase {
            TimerPhase::Focus if self.completed_focus_sessions.is_multiple_of(4) => {
                TimerPhase::Long
            }
            TimerPhase::Focus => TimerPhase::Short,
            TimerPhase::Short | TimerPhase::Long => TimerPhase::Focus,
        };
        self.status = TimerStatus::Running;
        self.remaining_duration =
            Duration::from_secs(u64::from(self.durations.seconds_for(self.phase)));
        self.deadline = Some(now + self.remaining_duration);
        self.revision += 1;
        Ok(true)
    }

    pub(crate) fn refresh(&mut self, now: Instant) -> bool {
        if self.status != TimerStatus::Running {
            return false;
        }
        let Some(deadline) = self.deadline else {
            return false;
        };
        let previous_seconds = rounded_seconds(self.remaining_duration);
        self.remaining_duration = deadline.saturating_duration_since(now);
        let remaining_seconds = rounded_seconds(self.remaining_duration);
        if remaining_seconds == previous_seconds {
            return false;
        }
        if remaining_seconds == 0 {
            self.status = TimerStatus::Completed;
            self.deadline = None;
            if self.phase == TimerPhase::Focus {
                self.completed_focus_sessions += 1;
            }
        }
        self.revision += 1;
        true
    }

    pub(crate) fn next_wake_delay(&self, now: Instant) -> Option<Duration> {
        if self.status != TimerStatus::Running {
            return None;
        }
        let deadline = self.deadline?;
        let remaining_seconds = remaining_seconds_at(deadline, now);
        if remaining_seconds == 0 {
            return Some(Duration::ZERO);
        }
        let next_change = deadline
            .checked_sub(Duration::from_secs(u64::from(remaining_seconds - 1)))
            .unwrap_or(now);
        Some(next_change.saturating_duration_since(now))
    }

    pub(crate) fn snapshot(&self) -> TimerSnapshot {
        TimerSnapshot {
            revision: self.revision,
            phase: self.phase,
            status: self.status,
            remaining_seconds: rounded_seconds(self.remaining_duration),
            durations: self.durations.clone(),
            completed_focus_sessions: self.completed_focus_sessions,
        }
    }

    pub(crate) fn revision(&self) -> u64 {
        self.revision
    }
}

fn remaining_seconds_at(deadline: Instant, now: Instant) -> u32 {
    rounded_seconds(deadline.saturating_duration_since(now))
}

fn rounded_seconds(remaining: Duration) -> u32 {
    let seconds = remaining.as_secs();
    let rounded = seconds.saturating_add(u64::from(remaining.subsec_nanos() > 0));
    u32::try_from(rounded).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pause_preserves_elapsed_time_and_resume_uses_the_remaining_duration() {
        let now = Instant::now();
        let mut timer = FocusTimerState::default();

        timer.start(now).unwrap();
        timer.pause(now + Duration::from_secs(10)).unwrap();

        assert_eq!(timer.snapshot().remaining_seconds, 1_490);

        timer.start(now + Duration::from_secs(10)).unwrap();
        timer.pause(now + Duration::from_secs(20)).unwrap();

        assert_eq!(timer.snapshot().remaining_seconds, 1_480);
    }

    #[test]
    fn subsecond_pause_resume_does_not_extend_the_session() {
        let now = Instant::now();
        let mut timer = FocusTimerState::default();
        timer
            .configure(
                TimerDurations {
                    focus: 1,
                    short: 5,
                    long: 15,
                },
                now,
            )
            .unwrap();

        timer.start(now).unwrap();
        timer.pause(now + Duration::from_millis(250)).unwrap();
        timer.refresh(now + Duration::from_secs(1_000));
        assert_eq!(timer.snapshot().status, TimerStatus::Paused);
        assert_eq!(timer.snapshot().remaining_seconds, 60);

        let first_resume = now + Duration::from_secs(3_600);
        timer.start(first_resume).unwrap();
        timer
            .pause(first_resume + Duration::from_millis(750))
            .unwrap();
        assert_eq!(timer.snapshot().remaining_seconds, 59);

        let second_resume = now + Duration::from_secs(7_200);
        timer.start(second_resume).unwrap();
        timer.refresh(second_resume + Duration::from_millis(58_999));
        assert_eq!(timer.snapshot().status, TimerStatus::Running);
        assert_eq!(timer.snapshot().remaining_seconds, 1);

        timer.refresh(second_resume + Duration::from_secs(59));
        assert_eq!(timer.snapshot().status, TimerStatus::Completed);
        assert_eq!(timer.snapshot().remaining_seconds, 0);
        timer.refresh(second_resume + Duration::from_secs(120));
        assert_eq!(timer.snapshot().completed_focus_sessions, 1);
    }

    #[test]
    fn configured_duration_waits_for_the_next_active_session() {
        let now = Instant::now();
        let mut timer = FocusTimerState::default();

        timer.start(now).unwrap();
        timer
            .configure(
                TimerDurations {
                    focus: 50,
                    short: 5,
                    long: 15,
                },
                now + Duration::from_secs(10),
            )
            .unwrap();

        assert_eq!(timer.snapshot().remaining_seconds, 1_490);

        timer.pause(now + Duration::from_secs(10)).unwrap();
        timer.reset(now + Duration::from_secs(10));

        assert_eq!(timer.snapshot().remaining_seconds, 3_000);
    }

    #[test]
    fn switching_an_active_phase_requires_explicit_discard() {
        let now = Instant::now();
        let mut timer = FocusTimerState::default();

        timer.start(now).unwrap();

        assert!(
            timer
                .select_phase(TimerPhase::Short, false, now + Duration::from_secs(1))
                .is_err()
        );

        timer
            .select_phase(TimerPhase::Short, true, now + Duration::from_secs(1))
            .unwrap();

        let snapshot = timer.snapshot();
        assert_eq!(snapshot.phase, TimerPhase::Short);
        assert_eq!(snapshot.status, TimerStatus::Ready);
        assert_eq!(snapshot.remaining_seconds, 300);
    }

    #[test]
    fn completed_focus_session_advances_to_a_manually_started_short_break() {
        let now = Instant::now();
        let mut timer = FocusTimerState::default();

        timer
            .configure(
                TimerDurations {
                    focus: 1,
                    short: 5,
                    long: 15,
                },
                now,
            )
            .unwrap();
        timer.start(now).unwrap();
        timer.refresh(now + Duration::from_secs(60));

        let completed = timer.snapshot();
        assert_eq!(completed.status, TimerStatus::Completed);
        assert_eq!(completed.completed_focus_sessions, 1);

        timer.start_next(now + Duration::from_secs(60)).unwrap();

        let next = timer.snapshot();
        assert_eq!(next.phase, TimerPhase::Short);
        assert_eq!(next.status, TimerStatus::Running);
        assert_eq!(next.remaining_seconds, 300);
    }

    #[test]
    fn fourth_completed_focus_session_advances_to_a_long_break() {
        let now = Instant::now();
        let mut timer = FocusTimerState::default();
        timer
            .configure(
                TimerDurations {
                    focus: 1,
                    short: 1,
                    long: 15,
                },
                now,
            )
            .unwrap();

        for completed_sessions in 1_u64..=4 {
            let start = now + Duration::from_secs(completed_sessions * 61);
            timer.start(start).unwrap();
            timer.refresh(start + Duration::from_secs(60));
            timer.start_next(start + Duration::from_secs(60)).unwrap();

            if completed_sessions < 4 {
                timer
                    .select_phase(TimerPhase::Focus, true, start + Duration::from_secs(60))
                    .unwrap();
            }
        }

        assert_eq!(timer.snapshot().phase, TimerPhase::Long);
    }

    #[test]
    fn durations_outside_the_supported_range_are_rejected_without_mutation() {
        let now = Instant::now();
        let mut timer = FocusTimerState::default();
        let before = timer.snapshot();

        let result = timer.configure(
            TimerDurations {
                focus: 0,
                short: 5,
                long: 15,
            },
            now,
        );

        assert!(result.is_err());
        assert_eq!(timer.snapshot().durations, before.durations);
        assert_eq!(timer.snapshot().remaining_seconds, before.remaining_seconds);
    }
}
