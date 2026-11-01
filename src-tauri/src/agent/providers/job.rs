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
    System::{
        Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First, Thread32Next,
        },
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, QueryInformationJobObject,
            JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JobObjectBasicAccountingInformation,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
            SetInformationJobObject, TerminateJobObject,
        },
        Threading::{
            CREATE_NO_WINDOW, CREATE_SUSPENDED, OpenProcess, OpenThread, PROCESS_SET_QUOTA,
            PROCESS_TERMINATE, ResumeThread, THREAD_SUSPEND_RESUME,
        },
    },
};

struct ScopedHandle(HANDLE);

impl Drop for ScopedHandle {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0) };
    }
}

pub struct Job(HANDLE);

unsafe impl Send for Job {}

impl Job {
    fn attach(pid: u32) -> Result<Self, ()> {
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
        let process = ScopedHandle(process);
        if unsafe { AssignProcessToJobObject(job.0, process.0) } == 0 {
            return Err(());
        }
        Ok(job)
    }

    fn resume(pid: u32) -> Result<(), ()> {
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
        if snapshot == INVALID_HANDLE_VALUE {
            return Err(());
        }
        let snapshot = ScopedHandle(snapshot);
        let mut entry: THREADENTRY32 = unsafe { std::mem::zeroed() };
        entry.dwSize = std::mem::size_of::<THREADENTRY32>() as u32;
        if unsafe { Thread32First(snapshot.0, &mut entry) } == 0 {
            return Err(());
        }
        loop {
            if entry.th32OwnerProcessID == pid {
                let thread = unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID) };
                if thread.is_null() {
                    return Err(());
                }
                let thread = ScopedHandle(thread);
                let previous = unsafe { ResumeThread(thread.0) };
                return if previous == u32::MAX || previous == 0 {
                    Err(())
                } else {
                    Ok(())
                };
            }
            if unsafe { Thread32Next(snapshot.0, &mut entry) } == 0 {
                return Err(());
            }
        }
    }

    pub fn spawn(mut command: Command) -> Result<(Child, Self), ()> {
        command
            .creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED)
            .kill_on_drop(true);
        let mut child = command.spawn().map_err(|_| ())?;
        let job = match child.id().and_then(|pid| Self::attach(pid).ok()) {
            Some(job) => job,
            None => {
                let _ = child.start_kill();
                return Err(());
            }
        };
        if child.id().is_none_or(|pid| Self::resume(pid).is_err()) {
            job.terminate();
            let _ = child.start_kill();
            return Err(());
        }
        Ok((child, job))
    }

    pub async fn probe(mut command: Command, deadline: Duration) -> Result<Output, ()> {
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let (child, job) = Self::spawn(command)?;
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
        if success == 0 {
            Err(())
        } else {
            Ok(info.ActiveProcesses)
        }
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
    use std::time::Instant;

    #[tokio::test]
    async fn suspended_child_resumes_with_piped_output() {
        let mut command = Command::new("cmd.exe");
        command.args(["/d", "/c", "echo OTTO_JOB_READY"]);
        let output = Job::probe(command, Duration::from_secs(5))
            .await
            .expect("owned child must start and complete");
        assert!(output.status.success());
        assert!(String::from_utf8_lossy(&output.stdout).contains("OTTO_JOB_READY"));
    }

    #[tokio::test]
    async fn terminating_job_reaps_descendant_processes() {
        use tokio::io::AsyncBufReadExt;

        let mut command = Command::new("powershell.exe");
        command.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$psi = [Diagnostics.ProcessStartInfo]::new('powershell.exe'); $psi.Arguments = '-NoProfile -NonInteractive -Command Start-Sleep -Seconds 20'; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true; $child = [Diagnostics.Process]::Start($psi); Write-Output $child.Id; Start-Sleep -Seconds 20",
        ]);
        command.stdout(Stdio::piped());
        let (mut child, job) = Job::spawn(command).expect("owned parent process must start");
        let stdout = child.stdout.take().expect("parent stdout pipe");
        let mut reader = tokio::io::BufReader::new(stdout);
        let mut descendant = String::new();
        timeout(Duration::from_secs(10), reader.read_line(&mut descendant))
            .await
            .expect("descendant startup must finish")
            .expect("parent should report child PID");
        assert!(descendant.trim().parse::<u32>().is_ok());
        assert!(job.active_processes().expect("job accounting") >= 2);
        job.terminate();
        timeout(Duration::from_secs(5), async {
            while job.active_processes().expect("job accounting") != 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("owned descendants must exit after Job termination");
        let _ = child.wait().await;
    }

    #[tokio::test]
    async fn deadline_terminates_owned_probe() {
        let mut command = Command::new("powershell.exe");
        command.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Start-Sleep -Seconds 5",
        ]);
        let started = Instant::now();
        assert!(Job::probe(command, Duration::from_millis(100)).await.is_err());
        assert!(started.elapsed() < Duration::from_secs(4));
    }
}
