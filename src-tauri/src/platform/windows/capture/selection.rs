use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationTextPattern, UIA_TextPatternId,
};

const MAX_SELECTION_BYTES: usize = 24_000;
const MAX_SELECTION_CHARACTERS: i32 = 24_000;
const MAX_PARENT_DEPTH: usize = 16;
const MAX_RANGES: i32 = 16;

struct ComApartment;

impl ComApartment {
    fn initialize() -> Result<Self, String> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
            .ok()
            .map_err(|_| "Windows text selection service is unavailable.".to_string())?;
        Ok(Self)
    }
}

impl Drop for ComApartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

pub(super) fn capture_selected_text() -> Result<String, String> {
    let _apartment = ComApartment::initialize()?;
    let automation: IUIAutomation = unsafe {
        CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
            .map_err(|_| "Windows text selection service could not start.")?
    };
    let walker = unsafe { automation.RawViewWalker() }
        .map_err(|_| "Windows could not inspect the selected application.")?;
    let mut element = unsafe { automation.GetFocusedElement() }
        .map_err(|_| "Focus the application containing the selected text and retry.")?;

    for _ in 0..MAX_PARENT_DEPTH {
        if let Ok(pattern) =
            unsafe { element.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId) }
            && let Ok(text) = selected_text_from_pattern(&pattern)
        {
            return normalize_selected_text(&text);
        }
        element = unsafe { walker.GetParentElement(&element) }
            .map_err(|_| "The focused control does not expose readable selected text.")?;
    }

    Err("The focused control does not expose readable selected text.".into())
}

fn selected_text_from_pattern(pattern: &IUIAutomationTextPattern) -> Result<String, String> {
    let ranges = unsafe { pattern.GetSelection() }
        .map_err(|_| "Windows could not read the active text selection.")?;
    let range_count = unsafe { ranges.Length() }
        .map_err(|_| "Windows could not read the active text selection.")?
        .min(MAX_RANGES);
    let mut selected = String::new();
    for index in 0..range_count {
        let range = unsafe { ranges.GetElement(index) }
            .map_err(|_| "Windows could not read the active text selection.")?;
        let text = unsafe { range.GetText(MAX_SELECTION_CHARACTERS) }
            .map_err(|_| "Windows could not read the active text selection.")?
            .to_string();
        if text.trim().is_empty() {
            continue;
        }
        if !selected.is_empty() {
            selected.push('\n');
        }
        selected.push_str(&text);
    }
    Ok(selected)
}

pub(super) fn normalize_selected_text(value: &str) -> Result<String, String> {
    let normalized = value
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\0', "");
    let mut cleaned = String::new();
    let mut previous_blank = true;
    for line in normalized.lines() {
        let line = line.trim_end();
        let blank = line.trim().is_empty();
        if blank && previous_blank {
            continue;
        }
        if !cleaned.is_empty() {
            cleaned.push('\n');
        }
        cleaned.push_str(line);
        previous_blank = blank;
    }
    let cleaned = cleaned.trim();
    if cleaned.is_empty() {
        return Err("Select readable text in another application, then press the shortcut.".into());
    }
    let mut end = cleaned.len().min(MAX_SELECTION_BYTES);
    while !cleaned.is_char_boundary(end) {
        end -= 1;
    }
    Ok(cleaned[..end].to_owned())
}
