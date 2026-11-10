use std::io;
use std::mem::size_of;
use std::sync::Mutex;
use windows_sys::Win32::UI::Shell::{
    ABM_GETSTATE, ABM_SETSTATE, ABS_AUTOHIDE, APPBARDATA, SHAppBarMessage,
};

fn read_state() -> io::Result<u32> {
    let mut data = APPBARDATA {
        cbSize: size_of::<APPBARDATA>() as u32,
        ..Default::default()
    };
    Ok(unsafe { SHAppBarMessage(ABM_GETSTATE, &mut data) as u32 })
}

fn apply_state(state: u32) -> io::Result<u32> {
    let mut data = APPBARDATA {
        cbSize: size_of::<APPBARDATA>() as u32,
        lParam: state as isize,
        ..Default::default()
    };
    unsafe {
        SHAppBarMessage(ABM_SETSTATE, &mut data);
    }
    let actual = read_state()?;
    if (actual & ABS_AUTOHIDE) != (state & ABS_AUTOHIDE) {
        return Err(io::Error::other(
            "Windows did not retain the taskbar state.",
        ));
    }
    Ok(actual)
}

#[derive(Default)]
pub struct TaskbarState(Mutex<Option<u32>>);

impl TaskbarState {
    pub fn auto_hide(&self) -> io::Result<bool> {
        Ok(read_state()? & ABS_AUTOHIDE != 0)
    }

    pub fn set_otto_mode(&self, enabled: bool) -> io::Result<bool> {
        self.set_mode(enabled, read_state, apply_state)
    }

    fn set_mode(
        &self,
        enabled: bool,
        read: impl FnOnce() -> io::Result<u32>,
        apply: impl FnOnce(u32) -> io::Result<u32>,
    ) -> io::Result<bool> {
        let mut original = self
            .0
            .lock()
            .map_err(|_| io::Error::other("Taskbar state is unavailable."))?;
        let current = read()?;
        let saved = *original;
        let desired = if enabled {
            if saved.is_none() {
                *original = Some(current);
            }
            current | ABS_AUTOHIDE
        } else {
            saved.unwrap_or(current)
        };
        apply(desired)?;
        if !enabled && saved.is_some() {
            *original = None;
        }
        Ok(enabled)
    }

    pub fn restore(&self) -> io::Result<()> {
        let mut original = self
            .0
            .lock()
            .map_err(|_| io::Error::other("Taskbar state is unavailable."))?;
        if let Some(state) = *original {
            apply_state(state)?;
            *original = None;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabling_dock_restores_existing_auto_hide_without_reporting_failure() {
        let owner = TaskbarState::default();
        let baseline = ABS_AUTOHIDE | 2;
        assert!(
            owner
                .set_mode(
                    true,
                    || Ok(baseline),
                    |desired| {
                        assert_eq!(desired, baseline);
                        Ok(desired)
                    }
                )
                .unwrap()
        );
        assert!(
            !owner
                .set_mode(
                    false,
                    || Ok(baseline),
                    |desired| {
                        assert_eq!(desired, baseline);
                        Ok(desired)
                    }
                )
                .unwrap()
        );
        assert_eq!(*owner.0.lock().unwrap(), None);
    }

    #[test]
    fn disabling_unowned_mode_preserves_the_users_taskbar_state() {
        let owner = TaskbarState::default();
        assert!(
            !owner
                .set_mode(
                    false,
                    || Ok(ABS_AUTOHIDE),
                    |desired| {
                        assert_eq!(desired, ABS_AUTOHIDE);
                        Ok(desired)
                    }
                )
                .unwrap()
        );
    }

    #[test]
    fn failed_enable_retains_the_original_state_for_recovery() {
        let owner = TaskbarState::default();
        assert!(
            owner
                .set_mode(true, || Ok(2), |_| Err(io::Error::other("rejected")))
                .is_err()
        );
        assert_eq!(*owner.0.lock().unwrap(), Some(2));
        assert!(
            !owner
                .set_mode(
                    false,
                    || Ok(ABS_AUTOHIDE | 2),
                    |desired| {
                        assert_eq!(desired, 2);
                        Ok(desired)
                    }
                )
                .unwrap()
        );
        assert_eq!(*owner.0.lock().unwrap(), None);
    }

    #[test]
    fn auto_hide_bit_is_reversible_without_touching_other_state() {
        let state = ABS_AUTOHIDE | 2;
        assert_eq!(state & !ABS_AUTOHIDE, 2);
        assert_eq!((state | ABS_AUTOHIDE) & ABS_AUTOHIDE, ABS_AUTOHIDE);
        assert_eq!((state & !ABS_AUTOHIDE) & ABS_AUTOHIDE, 0);
    }
}
