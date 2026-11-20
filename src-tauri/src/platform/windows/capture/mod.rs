mod hotkey;
mod image;
mod insert;
mod region;
mod region_overlay;
mod region_scroll;
mod region_state;
mod scroll;
mod selection;
mod target;

pub use hotkey::{CaptureHotkeys, start_hotkey};
#[cfg(test)]
use hotkey::{CaptureIntent, CaptureSource, capture_intent, parse_shortcut, update_hotkey_slot};
#[cfg(test)]
use image::{CAPTURE_FILE_PREFIX, capture_file_owner, cleanup_orphan_captures};
pub(crate) use insert::insert_text_at_caret;
#[cfg(test)]
use insert::unicode_inputs;
#[cfg(test)]
use selection::normalize_selected_text;
pub use target::capture_target_title;
#[cfg(test)]
use target::{WindowTarget, choose_capture_target};
#[cfg(test)]
mod tests;
