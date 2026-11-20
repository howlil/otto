use super::*;
use std::{
    fs,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::{Duration, SystemTime},
};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, MOD_CONTROL, MOD_NOREPEAT, VK_RETURN,
};

#[test]
fn cleanup_removes_only_old_captures_from_confirmed_exited_processes() {
    let now = SystemTime::now();
    let nonce = now
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let directory =
        std::env::temp_dir().join(format!("otto-cleanup-test-{}-{nonce}", std::process::id()));
    fs::create_dir(&directory).unwrap();
    let old = now - Duration::from_secs(48 * 60 * 60);
    let dead_pid = u32::MAX - 1;
    let active_pid = u32::MAX - 2;
    let dead_file = directory.join(format!("{CAPTURE_FILE_PREFIX}{dead_pid}-{nonce}.png"));
    let active_file = directory.join(format!("{CAPTURE_FILE_PREFIX}{active_pid}-{nonce}.png"));
    let recent_file = directory.join(format!(
        "{CAPTURE_FILE_PREFIX}{dead_pid}-1234567890123456.png"
    ));
    let unrelated_file = directory.join(format!("user-{dead_pid}-{nonce}.png"));
    let invalid_file = directory.join(format!("{CAPTURE_FILE_PREFIX}{dead_pid}-invalid.png"));

    for path in [
        &dead_file,
        &active_file,
        &recent_file,
        &unrelated_file,
        &invalid_file,
    ] {
        let file = fs::File::create(path).unwrap();
        if path != &recent_file {
            file.set_times(fs::FileTimes::new().set_modified(old))
                .unwrap();
        }
    }

    let count = cleanup_orphan_captures(&directory, now, |pid| pid == active_pid);
    assert_eq!(count, 1);
    assert!(!dead_file.exists());
    assert!(active_file.exists());
    assert!(recent_file.exists());
    assert!(unrelated_file.exists());
    assert!(invalid_file.exists());
    assert_eq!(
        cleanup_orphan_captures(&directory, now, |pid| pid == active_pid),
        0
    );
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn capture_cleanup_rejects_unowned_or_ambiguous_names() {
    assert_eq!(
        capture_file_owner("otto-capture-42-1234567890123456.png"),
        Some(42)
    );
    for name in [
        "otto-42-1234567890123456.png",
        "otto-capture-0-1234567890123456.png",
        "otto-capture-42-invalid.png",
        "otto-capture-42-1234567890123456.txt",
        "otto-capture-42-1234567890123456.png.bak",
        "otto-capture-42-1234567890123456/../../secret.png",
    ] {
        assert_eq!(capture_file_owner(name), None, "accepted {name}");
    }
}

#[test]
fn capture_target_preflight_rejects_invalid_window_without_scheduling_work() {
    let unavailable = capture_intent(CaptureSource::Window, true, || {
        Err("Window target changed. Refocus the app and retry.".into())
    });
    assert!(
        unavailable
            .err()
            .expect("invalid target must fail")
            .contains("Window target changed")
    );

    let no_hook = capture_intent(CaptureSource::Window, false, || {
        panic!("No window lookup is allowed when foreground tracking is unavailable")
    });
    assert_eq!(
        no_hook.err().expect("missing hook must fail"),
        "Window focus tracking is unavailable."
    );

    let target = WindowTarget {
        handle: 17,
        pid: 31,
    };
    let selected = capture_intent(CaptureSource::Window, true, || Ok(target)).unwrap();
    assert!(matches!(selected, CaptureIntent::Window(actual) if actual == target));

    let scrolling = capture_intent(CaptureSource::ScrollingWindow, true, || Ok(target)).unwrap();
    assert!(matches!(scrolling, CaptureIntent::ScrollingWindow(actual) if actual == target));

    let full_screen = capture_intent(CaptureSource::FullScreen, false, || {
        panic!("Full-screen capture must not require a window target or foreground hook")
    });
    assert!(matches!(full_screen, Ok(CaptureIntent::FullScreen)));

    let selected_text = capture_intent(CaptureSource::SelectedText, false, || {
        panic!("Selected text must not require a window target or foreground hook")
    });
    assert!(matches!(selected_text, Ok(CaptureIntent::SelectedText)));

    let region = capture_intent(CaptureSource::Region, false, || {
        panic!("Region capture must not require a window target or foreground hook")
    });
    assert!(matches!(region, Ok(CaptureIntent::Region)));
}

#[test]
fn source_configuration_failure_preserves_capture_hotkey_state() {
    let (changes, _messages) = mpsc::channel();
    let gate = Arc::new(AtomicBool::new(true));
    let hotkeys = CaptureHotkeys {
        changes,
        thread_id: 0,
        armed: Arc::clone(&gate),
    };
    assert!(hotkeys.configure_source("fullScreen").is_err());
    assert!(gate.load(Ordering::SeqCst));
}

#[test]
fn unsupported_capture_source_never_selects_a_default() {
    assert_eq!(
        CaptureSource::parse("selectedText").unwrap(),
        CaptureSource::SelectedText
    );
    assert_eq!(
        CaptureSource::parse("window").unwrap(),
        CaptureSource::Window
    );
    assert_eq!(
        CaptureSource::parse("scrollingWindow").unwrap(),
        CaptureSource::ScrollingWindow
    );
    assert_eq!(
        CaptureSource::parse("fullScreen").unwrap(),
        CaptureSource::FullScreen
    );
    assert_eq!(
        CaptureSource::parse("region").unwrap(),
        CaptureSource::Region
    );
    assert!(CaptureSource::parse("screen").is_err());
    assert!(CaptureSource::parse("").is_err());
}

#[test]
fn selected_text_is_cleaned_and_bounded_without_breaking_utf8() {
    let cleaned = normalize_selected_text("\r\nQuestion?  \r\n\r\n\r\nAnswer\0\r\n").unwrap();
    assert_eq!(cleaned, "Question?\n\nAnswer");

    let bounded = normalize_selected_text(&"🙂".repeat(10_000)).unwrap();
    assert!(bounded.len() <= 24_000);
    assert!(bounded.is_char_boundary(bounded.len()));
    assert!(normalize_selected_text(" \r\n\0 ").is_err());
}

#[test]
fn text_insertion_builds_bounded_unicode_key_pairs() {
    let inputs = unicode_inputs("A🙂`").unwrap();
    assert_eq!(inputs.len(), 8);
    unsafe {
        assert_eq!(inputs[0].Anonymous.ki.wScan, 'A' as u16);
        assert_eq!(inputs[0].Anonymous.ki.dwFlags, KEYEVENTF_UNICODE);
        assert_eq!(
            inputs[1].Anonymous.ki.dwFlags,
            KEYEVENTF_UNICODE | KEYEVENTF_KEYUP
        );
        assert_eq!(inputs[6].Anonymous.ki.wScan, '`' as u16);
        assert_eq!(inputs[6].Anonymous.ki.dwFlags, KEYEVENTF_UNICODE);
    }
    assert!(unicode_inputs("").is_err());
    assert!(unicode_inputs(&"a".repeat(32_001)).is_err());
}

#[test]
fn text_insertion_maps_line_breaks_to_enter_key_pairs() {
    let inputs = unicode_inputs("A\r\nB\nC\rD").unwrap();
    assert_eq!(inputs.len(), 14);
    for index in [2, 6, 10] {
        unsafe {
            assert_eq!(inputs[index].Anonymous.ki.wVk, VK_RETURN);
            assert_eq!(inputs[index].Anonymous.ki.wScan, 0);
            assert_eq!(inputs[index].Anonymous.ki.dwFlags, 0);
            assert_eq!(inputs[index + 1].Anonymous.ki.wVk, VK_RETURN);
            assert_eq!(inputs[index + 1].Anonymous.ki.wScan, 0);
            assert_eq!(inputs[index + 1].Anonymous.ki.dwFlags, KEYEVENTF_KEYUP);
        }
    }
}

#[test]
fn unknown_foreground_never_falls_back_to_an_unrelated_window() {
    let last = WindowTarget {
        handle: 10,
        pid: 20,
    };
    let current = WindowTarget {
        handle: 30,
        pid: 40,
    };
    assert_eq!(
        choose_capture_target(0, 99, Some(current), Some(last)),
        None
    );
    assert_eq!(choose_capture_target(99, 99, None, Some(last)), Some(last));
    assert_eq!(
        choose_capture_target(40, 99, Some(current), Some(last)),
        Some(current)
    );
    assert_eq!(choose_capture_target(40, 99, None, Some(last)), None);
}

#[test]
fn captured_window_identity_must_not_change_process() {
    let pinned = WindowTarget {
        handle: 12,
        pid: 42,
    };
    assert!(pinned.matches(12, 42));
    assert!(!pinned.matches(12, 43));
    assert!(!pinned.matches(13, 42));
    assert!(!pinned.matches(12, 0));
}

#[test]
fn shortcuts_require_explicit_safe_modifiers_and_single_letter() {
    assert_eq!(parse_shortcut("Ctrl+Shift+O").unwrap().key, b'O' as u32);
    assert_eq!(
        parse_shortcut("ctrl+ALT+p").unwrap().modifiers,
        MOD_CONTROL | windows_sys::Win32::UI::Input::KeyboardAndMouse::MOD_ALT | MOD_NOREPEAT
    );
    for invalid in [
        "O",
        "Alt+O",
        "Ctrl+O",
        "Ctrl+Shift+1",
        "Ctrl+Ctrl+O",
        "Ctrl+Win+O",
        "",
    ] {
        assert!(parse_shortcut(invalid).is_err(), "accepted {invalid}");
    }
}

#[test]
fn dual_capture_shortcuts_reject_conflicting_key_bindings() {
    let visual = parse_shortcut("Ctrl+Shift+O").unwrap();
    let text = parse_shortcut("Ctrl+Shift+T").unwrap();
    let mut text_slot = Some(text);
    let err = update_hotkey_slot(0x4f55, &mut text_slot, Some(visual), visual).unwrap_err();
    assert!(err.contains("different keys"));
    assert_eq!(text_slot, Some(text));
    assert!(update_hotkey_slot(0x4f55, &mut text_slot, Some(visual), text).is_ok());
}
