use std::io;
use windows_sys::Win32::Foundation::{CloseHandle, ERROR_ALREADY_EXISTS, GetLastError, HANDLE};
use windows_sys::Win32::System::Threading::CreateMutexW;

const MUTEX_NAME: &str = "Local\\site.howlil.otto.single-instance";

pub struct InstanceGuard(HANDLE);

pub fn acquire() -> io::Result<Option<InstanceGuard>> {
    acquire_named(MUTEX_NAME)
}

fn acquire_named(name: &str) -> io::Result<Option<InstanceGuard>> {
    let mut wide_name = name.encode_utf16().collect::<Vec<_>>();
    wide_name.push(0);
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
    fn duplicate_rejected_until_owner_drops_handle() {
        let name = format!("Local\\site.howlil.otto.test.{}", std::process::id());
        let original = acquire_named(&name).unwrap().expect("first instance");
        assert!(acquire_named(&name).unwrap().is_none());
        drop(original);
        assert!(acquire_named(&name).unwrap().is_some());
    }

    #[test]
    fn concurrent_threads_have_exactly_one_owner() {
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
                    let guard = acquire_named(&name);
                    acquired.wait();
                    guard.map(|guard| guard.is_some())
                })
            })
            .collect::<Vec<_>>();
        let owners = threads
            .into_iter()
            .map(|thread| thread.join().unwrap().expect("Windows mutex acquisition"))
            .filter(|owns| *owns)
            .count();
        assert_eq!(owners, 1);
    }

    #[test]
    fn duplicate_rejected_across_independent_processes() {
        let name = format!("Local\\site.howlil.otto.test.process.{}", std::process::id());
        let _owner = acquire_named(&name).unwrap().expect("parent owns mutex");
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "windows::single_instance::tests::child_observes_parent_mutex"])
            .env("OTTO_TEST_SINGLE_INSTANCE_MUTEX", &name)
            .output()
            .expect("launch independent test process");
        assert!(
            output.status.success()
                && String::from_utf8_lossy(&output.stdout).contains("1 passed"),
            "child process regression failed: stdout={} stderr={}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn child_observes_parent_mutex() {
        if let Some(name) = std::env::var_os("OTTO_TEST_SINGLE_INSTANCE_MUTEX") {
            assert!(acquire_named(&name.to_string_lossy()).unwrap().is_none());
        }
    }
}
