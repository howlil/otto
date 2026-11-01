use std::io;
use windows_sys::Win32::Foundation::{CloseHandle, ERROR_ALREADY_EXISTS, GetLastError, HANDLE};
use windows_sys::Win32::System::Threading::CreateMutexW;

const MUTEX_NAME: &str = "Local\\site.howlil.otto.single-instance";

pub struct InstanceGuard(HANDLE);

pub fn acquire() -> io::Result<Option<InstanceGuard>> {
    acquire_named(MUTEX_NAME)
}

fn acquire_named(name: &str) -> io::Result<Option<InstanceGuard>> {
    let wide_name = name.encode_utf16().chain(std::iter::once(0)).collect::<Vec<_>>();
    let handle = unsafe { CreateMutexW(std::ptr::null(), 0, wide_name.as_ptr()) };
    let error = unsafe { GetLastError() };

    if handle.is_null() {
        return Err(io::Error::from_raw_os_error(error as i32));
    }
    if error == ERROR_ALREADY_EXISTS {
        unsafe { CloseHandle(handle) };
        return Ok(None);
    }
    Ok(Some(InstanceGuard(handle)))
}

impl Drop for InstanceGuard {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    use std::thread;

    #[test]
    fn duplicate_is_rejected_until_original_guard_is_dropped() {
        let name = format!("Local\\site.howlil.otto.test.{}", std::process::id());
        let original = acquire_named(&name).unwrap().expect("original owns mutex");

        assert!(acquire_named(&name).unwrap().is_none());

        drop(original);
        assert!(acquire_named(&name).unwrap().is_some());
    }

    #[test]
    fn concurrent_launches_have_only_one_owner() {
        let name = format!("Local\\site.howlil.otto.test.concurrent.{}", std::process::id());
        let start = Arc::new(Barrier::new(8));
        let acquired = Arc::new(Barrier::new(8));
        let threads = (0..8)
            .map(|_| {
                let name = name.clone();
                let start = Arc::clone(&start);
                let acquired = Arc::clone(&acquired);
                thread::spawn(move || {
                    start.wait();
                    let guard = acquire_named(&name).unwrap();
                    acquired.wait();
                    guard.is_some()
                })
            })
            .collect::<Vec<_>>();

        let owners = threads
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .filter(|owns| *owns)
            .count();
        assert_eq!(owners, 1);
    }
}
