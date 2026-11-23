use std::io;
use tauri::WebviewWindow;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL, ICoreWebView2_19,
};
use windows::core::Interface;

const MEMORY_LEVEL_NORMAL: i32 = 0;
const MEMORY_LEVEL_LOW: i32 = 1;

fn target_memory_level(low: bool) -> COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL {
    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL(if low {
        MEMORY_LEVEL_LOW
    } else {
        MEMORY_LEVEL_NORMAL
    })
}

pub fn set_webview_low_memory(window: &WebviewWindow, low: bool) -> io::Result<()> {
    let level = target_memory_level(low);
    window
        .with_webview(move |webview| {
            let controller = webview.controller();
            if let Ok(core) = unsafe { controller.CoreWebView2() }
                && let Ok(wv19) = core.cast::<ICoreWebView2_19>()
            {
                let _ = unsafe { wv19.SetMemoryUsageTargetLevel(level) };
            }
        })
        .map_err(io::Error::other)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_target_level_maps_normal_and_low_flags() {
        assert_eq!(target_memory_level(false).0, MEMORY_LEVEL_NORMAL);
        assert_eq!(target_memory_level(true).0, MEMORY_LEVEL_LOW);
    }
}
