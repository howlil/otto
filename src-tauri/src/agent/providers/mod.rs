#[cfg(windows)]
pub mod agy;
pub mod codex;
#[cfg(windows)]
mod job;
#[cfg(windows)]
pub mod pi;
pub mod registry;
use std::ffi::OsStr;
use tokio::process::Command;

#[cfg(windows)]
use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

pub(super) fn background_command(executable: impl AsRef<OsStr>) -> Command {
    #[cfg(windows)]
    {
        let mut command = Command::new(executable);
        command.creation_flags(CREATE_NO_WINDOW);
        command
    }
    #[cfg(not(windows))]
    {
        Command::new(executable)
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::background_command;
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[tokio::test]
    async fn windows_batch_shim_does_not_create_a_console() {
        let script = r#"Add-Type -Namespace Otto -Name Probe -MemberDefinition '[DllImport("kernel32.dll")] public static extern System.IntPtr GetConsoleWindow();'; if ([Otto.Probe]::GetConsoleWindow() -ne [IntPtr]::Zero) { exit 19 }; Write-Output 'OTTO_HIDDEN_OK'"#;
        let bytes = script
            .encode_utf16()
            .flat_map(|unit| unit.to_le_bytes())
            .collect::<Vec<_>>();
        let encoded = STANDARD.encode(bytes);
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let file = std::env::temp_dir().join(format!(
            "otto-hidden-cli-{}-{stamp}.cmd",
            std::process::id()
        ));
        fs::write(
            &file,
            format!("@echo off\r\npowershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand {encoded}\r\nexit /b %ERRORLEVEL%\r\n"),
        )
        .unwrap();
        let result = background_command(&file).output().await;
        fs::remove_file(&file).unwrap();
        let output = result.expect("Windows batch shim must spawn");
        assert!(
            output.status.success(),
            "CLI opened a console or its probe failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("OTTO_HIDDEN_OK"));

        let direct = background_command("powershell.exe")
            .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", &encoded])
            .output()
            .await
            .expect("Windows executable must spawn");
        assert!(direct.status.success());
        assert!(String::from_utf8_lossy(&direct.stdout).contains("OTTO_HIDDEN_OK"));
    }
}
