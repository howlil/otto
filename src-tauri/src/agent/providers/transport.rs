#[cfg(windows)]
use super::job::Job;
use std::{
    ffi::{OsStr, OsString},
    path::Path,
    process::Stdio,
    time::Duration,
};
use tokio::{
    io::{AsyncWriteExt, BufReader},
    process::{Child, ChildStderr, ChildStdin, ChildStdout, Command},
    time::timeout,
};

pub(crate) struct JsonlProcess {
    #[cfg(windows)]
    job: Job,
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl JsonlProcess {
    pub(crate) fn launch<I, S>(
        name: &str,
        binary: &Path,
        args: I,
        cwd: &Path,
        piped_stderr: bool,
        start_error: &'static str,
    ) -> Result<(Self, Option<ChildStderr>), String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let args = args
            .into_iter()
            .map(|value| value.as_ref().to_os_string())
            .collect::<Vec<OsString>>();
        #[cfg(windows)]
        let mut command = if matches!(
            binary.extension().and_then(OsStr::to_str),
            Some(extension) if extension.eq_ignore_ascii_case("cmd") || extension.eq_ignore_ascii_case("bat")
        ) {
            let mut command = Command::new("cmd.exe");
            command.args(["/D", "/S", "/C"]).arg(binary);
            command
        } else {
            Command::new(binary)
        };
        #[cfg(not(windows))]
        let mut command = Command::new(binary);
        command
            .args(args)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(if piped_stderr {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .kill_on_drop(true);
        #[cfg(windows)]
        let (mut child, job) = Job::spawn(command).map_err(|_| start_error.to_string())?;
        #[cfg(not(windows))]
        let mut child = command.spawn().map_err(|_| start_error.to_string())?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| format!("{name} stdin unavailable."))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| format!("{name} stdout unavailable."))?;
        let stderr = child.stderr.take();
        Ok((
            Self {
                #[cfg(windows)]
                job,
                child,
                stdin,
                stdout: BufReader::new(stdout),
            },
            stderr,
        ))
    }

    pub(crate) fn reader(&mut self) -> &mut BufReader<ChildStdout> {
        &mut self.stdout
    }

    pub(crate) async fn send_line(
        &mut self,
        payload: Vec<u8>,
        disconnected: &'static str,
    ) -> Result<(), String> {
        let mut line = payload;
        line.push(b'\n');
        self.stdin
            .write_all(&line)
            .await
            .map_err(|_| disconnected.to_string())?;
        self.stdin
            .flush()
            .await
            .map_err(|_| disconnected.to_string())
    }

    pub(crate) async fn terminate_tree(&mut self) {
        #[cfg(windows)]
        self.job.terminate();
        let _ = timeout(Duration::from_secs(3), self.child.wait()).await;
        let _ = self.child.start_kill();
    }

    pub(crate) async fn kill_now(&mut self) {
        #[cfg(windows)]
        self.job.terminate();
        let _ = self.child.kill().await;
        let _ = self.child.wait().await;
    }
}
