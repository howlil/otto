#[cfg(windows)]
pub(in crate::agent) mod acp;
pub(in crate::agent) mod catalog;
#[cfg(windows)]
pub(in crate::agent) mod claude;
pub(in crate::agent) mod codex;
#[cfg(windows)]
pub(in crate::agent) mod opencode;
#[cfg(windows)]
pub(in crate::agent) mod pi;
mod process;
pub(in crate::agent) mod registry;
mod support;
#[cfg(test)]
mod tests;

pub(in crate::agent::providers) use process::command_for_binary;
pub(in crate::agent::providers) use process::framing::{BoundedLineError, read_bounded_line};
#[cfg(windows)]
pub(in crate::agent::providers) use process::job;
pub(in crate::agent::providers) use process::transport;
pub(in crate::agent::providers) use support::rate_limits;
pub(in crate::agent::providers) use support::{
    authentication_required, encode_png_capture, find_executable, refreshed_path_override,
};
pub(in crate::agent) use support::{refresh_live_path, stage_base64_png};
