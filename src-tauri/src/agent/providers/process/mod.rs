pub(in crate::agent::providers) mod framing;
#[cfg(windows)]
pub(in crate::agent::providers) mod job;
pub(in crate::agent::providers) mod transport;

pub(in crate::agent::providers) fn command_for_binary(
    binary: impl AsRef<std::path::Path>,
) -> tokio::process::Command {
    let binary = binary.as_ref();
    let mut command = {
        #[cfg(windows)]
        {
            if matches!(
                binary.extension().and_then(std::ffi::OsStr::to_str),
                Some(extension)
                    if extension.eq_ignore_ascii_case("cmd") || extension.eq_ignore_ascii_case("bat")
            ) {
                let mut cmd = tokio::process::Command::new("cmd.exe");
                cmd.args(["/D", "/S", "/C"]).arg(binary);
                cmd
            } else {
                tokio::process::Command::new(binary)
            }
        }
        #[cfg(not(windows))]
        {
            tokio::process::Command::new(binary)
        }
    };
    if let Some(refreshed_path) = super::refreshed_path_override() {
        command.env("PATH", refreshed_path);
    }
    command
}
