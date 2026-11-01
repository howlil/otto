use std::{
    process::{Output, Stdio},
    time::Duration,
};
use tokio::{
    process::{Child, Command},
    time::timeout,
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE},
    System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First, Thread32Next,
    },
    System::{
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, QueryInformationJobObject,
            JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JobObjectBasicAccountingInformation,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
            SetInformationJobObject, TerminateJobObject,
        },
        Threading::{
            CREATE_NO_WINDOW, CREATE_SUSPENDED, OpenProcess, OpenThread, ResumeThread,
            PROCESS_SET_QUOTA, PROCESS_TERMINATE, THREAD_SUSPEND_RESUME,
        },
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

    fn resume_child(pid: u32) -> Result<(), ()> {
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
        if snapshot == INVALID_HANDLE_VALUE {
            return Err(());
        }
        let mut entry: THREADENTRY32 = unsafe { std::mem::zeroed() };
        entry.dwSize = std::mem::size_of::<THREADENTRY32>() as u32;
        let mut resumed = false;
        if unsafe { Thread32First(snapshot, &mut entry) } != 0 {
            loop {
                if entry.th32OwnerProcessID == pid {
                    let thread = unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID) };
                    if !thread.is_null() {
                        let previous_count = unsafe { ResumeThread(thread) };
                        unsafe { CloseHandle(thread) };
                        resumed = previous_count != u32::MAX && previous_count > 0;
                    }
                    break;
                }
                if unsafe { Thread32Next(snapshot, &mut entry) } == 0 {
                    break;
                }
            }
        }
        unsafe { CloseHandle(snapshot) };
        if resumed { Ok(()) } else { Err(()) }
    }

    pub fn spawn(command: &mut Command) -> Result<(Self, Child), ()> {
        command.creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED);
        let mut child = command.spawn().map_err(|_| ())?;
        let attached = child
            .id()
            .ok_or(())
            .and_then(|pid| {
                let job = Self::attach(pid)?;
                if Self::resume_child(pid).is_err() {
                    job.terminate();
                    Err(())
                } else {
                    Ok(job)
                }
            });
        match attached {
            Ok(job) => Ok((job, child)),
            Err(()) => {
                let _ = child.start_kill();
                Err(())
            }
        }
    }

    pub async fn probe(mut command: Command, deadline: Duration) -> Result<Output, ()> {
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let (job, child) = Self::spawn(&mut command)?;
        let result = timeout(deadline, child.wait_with_output()).await;
        job.terminate();
        result.map_err(|_| ())?.map_err(|_| ())
    }

    #[cfg(test)]
    fn active_processes(&self) -> Result<u32, ()> {
        let mut info: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { std::mem::zeroed() };
        let success = unsafe {
            QueryInformationJobObject(
                self.0,
                JobObjectBasicAccountingInformation,
                &mut info as *mut _ as *mut _,
                std::mem::size_of_val(&info) as u32,
                std::ptr::null_mut(),
            )
        };
        if success == 0 { Err(()) } else { Ok(info.ActiveProcesses) }
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

    #[tokio::test]
    async fn subprocess_resumes_after_job_assignment() {
        let mut command = super::super::background_command("cmd.exe");
        command.args(["/d", "/c", "echo OTTO_JOB_ACTIVE"]);
        command.stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
        let (job, child) = Job::spawn(&mut command).expect("process must attach and resume");
        let output = timeout(Duration::from_secs(5), child.wait_with_output())
            .await
            .expect("process must not remain suspended")
            .expect("process must exit");
        assert!(output.status.success());
        assert!(String::from_utf8_lossy(&output.stdout).contains("OTTO_JOB_ACTIVE"));
        drop(job);
    }

    #[tokio::test]
    async fn job_contains_and_terminates_a_spawned_descendant() {
        let mut command = super::super::background_command("powershell.exe");
        command.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$child = Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile -NonInteractive -Command Start-Sleep -Seconds 20' -WindowStyle Hidden -PassThru; Write-Output $child.Id; Start-Sleep -Seconds 20",
        ]);
        command.stdout(Stdio::piped()).kill_on_drop(true);
        let (job, mut child) = Job::spawn(&mut command).expect("PowerShell must be owned");
        let stdout = child.stdout.take().expect("stdout pipe");
        let mut line = String::new();
        use tokio::io::AsyncBufReadExt;
        let mut reader = tokio::io::BufReader::new(stdout);
        timeout(Duration::from_secs(10), reader.read_line(&mut line))
            .await
            .expect("child start must be bounded")
            .expect("child must return its descendant pid");
        assert!(line.trim().parse::<u32>().is_ok(), "invalid descendant pid");
        assert!(job.active_processes().expect("job accounting") >= 2);
        job.terminate();
        timeout(Duration::from_secs(5), async {
            while job.active_processes().expect("job accounting") != 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("entire owned process tree must exit");
        let _ = child.wait().await;
    }

    #[tokio::test]
    async fn readiness_probe_timeout_is_bounded() {
        let mut command = super::super::background_command("powershell.exe");
        command.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Start-Sleep -Seconds 5",
        ]);
        assert!(Job::probe(command, Duration::from_millis(100)).await.is_err());
    }
}
