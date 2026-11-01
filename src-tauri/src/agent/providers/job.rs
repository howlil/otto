use std::{process::{Output, Stdio}, time::Duration};
use tokio::{process::Command, time::timeout};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE},
    System::{
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
            SetInformationJobObject, TerminateJobObject,
        },
        Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE},
    },
};

pub struct Job(HANDLE);

unsafe impl Send for Job {}

impl Job {
    pub fn attach(pid: u32) -> Result<Self, ()> {
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(());
        }
        let job = Self(handle);
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                &mut info as *mut _ as *mut _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if configured == 0 {
            return Err(());
        }

        let process = unsafe { OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid) };
        if process.is_null() {
            return Err(());
        }
        let assigned = unsafe { AssignProcessToJobObject(job.0, process) };
        unsafe { CloseHandle(process) };
        if assigned == 0 {
            return Err(());
        }
        Ok(job)
    }

    pub async fn probe(mut command: Command, deadline: Duration) -> Result<Output, ()> {
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = command.spawn().map_err(|_| ())?;
        let job = match child.id().and_then(|pid| Self::attach(pid).ok()) {
            Some(job) => job,
            None => {
                let _ = child.start_kill();
                let _ = child.wait().await;
                return Err(());
            }
        };
        let result = timeout(deadline, child.wait_with_output()).await;
        job.terminate();
        result.map_err(|_| ())?.map_err(|_| ())
    }

    pub fn terminate(&self) {
        unsafe { TerminateJobObject(self.0, 1) };
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn readiness_probe_uses_hidden_owned_process_and_preserves_output() {
        let mut command = super::super::background_command("cmd.exe");
        command.args(["/d", "/c", "echo OTTO_PROBE_READY"]);
        let output = Job::probe(command, Duration::from_secs(5))
            .await
            .expect("owned probe must succeed");
        assert!(output.status.success());
        assert!(String::from_utf8_lossy(&output.stdout).contains("OTTO_PROBE_READY"));
    }
}
