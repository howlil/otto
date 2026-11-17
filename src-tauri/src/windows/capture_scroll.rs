use std::mem::size_of;
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::{HWND, POINT, RECT};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_WHEEL, MOUSEINPUT, SendInput,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetForegroundWindow, SetCursorPos, SetForegroundWindow, WHEEL_DELTA,
};

const MAX_SCROLL_STEPS: usize = 12;
const MAX_SCROLL_DURATION: Duration = Duration::from_millis(5500);
const SCROLL_SETTLE_DELAY: Duration = Duration::from_millis(260);
const FOCUS_SETTLE_DELAY: Duration = Duration::from_millis(80);
const SCROLL_NOTCHES: i32 = 4;
const STATIC_ROW_DIFF: u32 = 2;
const MAX_MATCH_CHANNEL_DIFF: u32 = 4;
const MIN_BAND_HEIGHT: usize = 32;
const MIN_SCROLL_DELTA: usize = 16;
const SCROLLBAR_GUARD_PX: usize = 24;
const FINGERPRINT_BUCKETS: usize = 16;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct RgbaFrame {
    pub width: usize,
    pub height: usize,
    pub pixels: Vec<u8>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct ScrollStep {
    pub scroll_top: usize,
    pub scroll_bottom: usize,
    pub delta_y: usize,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct ScrollLimits {
    pub max_height: usize,
    pub max_pixels: usize,
}

struct CursorRestore {
    original: Option<POINT>,
}

impl CursorRestore {
    fn capture() -> Self {
        let mut point = POINT { x: 0, y: 0 };
        let ok = unsafe { GetCursorPos(&mut point) } != 0;
        Self {
            original: ok.then_some(point),
        }
    }
}

impl Drop for CursorRestore {
    fn drop(&mut self) {
        if let Some(point) = self.original {
            unsafe { SetCursorPos(point.x, point.y) };
        }
    }
}

fn compare_span(width: usize) -> usize {
    width
        .saturating_sub(SCROLLBAR_GUARD_PX)
        .max(width / 2)
        .min(width)
}

fn row_bytes(frame: &RgbaFrame, y: usize) -> &[u8] {
    let stride = frame.width * 4;
    let start = y * stride;
    &frame.pixels[start..start + stride]
}

fn row_mean_diff(a: &RgbaFrame, ay: usize, b: &RgbaFrame, by: usize, span: usize) -> u32 {
    let row_a = row_bytes(a, ay);
    let row_b = row_bytes(b, by);
    let step = (span / 96).max(1);
    let mut sum = 0_u64;
    let mut samples = 0_u64;
    for x in (0..span).step_by(step) {
        let idx = x * 4;
        sum += row_a[idx].abs_diff(row_b[idx]) as u64
            + row_a[idx + 1].abs_diff(row_b[idx + 1]) as u64
            + row_a[idx + 2].abs_diff(row_b[idx + 2]) as u64;
        samples += 3;
    }
    if samples == 0 {
        return u32::MAX;
    }
    (sum / samples) as u32
}

fn row_fingerprints(frame: &RgbaFrame, span: usize) -> Vec<[u16; FINGERPRINT_BUCKETS]> {
    let mut out = Vec::with_capacity(frame.height);
    let bucket_width = (span / FINGERPRINT_BUCKETS).max(1);
    let step = (bucket_width / 4).max(1);
    for y in 0..frame.height {
        let row = row_bytes(frame, y);
        let mut buckets = [0_u16; FINGERPRINT_BUCKETS];
        for (bucket_idx, slot) in buckets.iter_mut().enumerate() {
            let start = bucket_idx * bucket_width;
            if start >= span {
                break;
            }
            let end = ((bucket_idx + 1) * bucket_width).min(span);
            let mut sum = 0_u32;
            let mut count = 0_u32;
            for x in (start..end).step_by(step) {
                let idx = x * 4;
                sum += row[idx] as u32 + row[idx + 1] as u32 + row[idx + 2] as u32;
                count += 3;
            }
            *slot = sum.checked_div(count).unwrap_or(0) as u16;
        }
        out.push(buckets);
    }
    out
}

fn fingerprint_diff(a: &[u16; FINGERPRINT_BUCKETS], b: &[u16; FINGERPRINT_BUCKETS]) -> u32 {
    a.iter()
        .zip(b.iter())
        .map(|(x, y)| x.abs_diff(*y) as u32)
        .sum::<u32>()
        / FINGERPRINT_BUCKETS as u32
}

fn band_row_variance(fingerprints: &[[u16; FINGERPRINT_BUCKETS]], start: usize, end: usize) -> u32 {
    if end <= start + 1 {
        return 0;
    }
    let step = ((end - start) / 24).max(1);
    let mut total = 0_u32;
    let mut y = start;
    while y + step < end {
        total = total.saturating_add(fingerprint_diff(&fingerprints[y], &fingerprints[y + step]));
        y += step;
    }
    total
}

pub(super) fn find_scroll_overlap(prev: &RgbaFrame, next: &RgbaFrame) -> Option<ScrollStep> {
    if prev.width == 0 || prev.height == 0 || prev.width != next.width || prev.height != next.height
    {
        return None;
    }
    let span = compare_span(prev.width);
    if span == 0 {
        return None;
    }
    let mut scroll_top = 0;
    while scroll_top < prev.height
        && row_mean_diff(prev, scroll_top, next, scroll_top, span) <= STATIC_ROW_DIFF
    {
        scroll_top += 1;
    }
    let mut scroll_bottom = prev.height;
    while scroll_bottom > scroll_top
        && row_mean_diff(prev, scroll_bottom - 1, next, scroll_bottom - 1, span) <= STATIC_ROW_DIFF
    {
        scroll_bottom -= 1;
    }
    let band_height = scroll_bottom.saturating_sub(scroll_top);
    if band_height < MIN_BAND_HEIGHT {
        return None;
    }
    let min_overlap = (band_height / 6).clamp(16, 120).min(band_height - 1);
    let min_delta = MIN_SCROLL_DELTA.min(band_height - min_overlap);
    let max_delta = band_height - min_overlap;
    if min_delta > max_delta {
        return None;
    }

    let prev_fp = row_fingerprints(prev, span);
    let next_fp = row_fingerprints(next, span);
    let mut coarse: Vec<(u32, usize)> = Vec::with_capacity(max_delta - min_delta + 1);
    for delta_y in min_delta..=max_delta {
        let overlap = band_height - delta_y;
        let row_step = (overlap / 24).max(1);
        let mut sum = 0_u64;
        let mut rows = 0_u64;
        let mut offset = 0;
        while offset < overlap {
            let py = scroll_top + delta_y + offset;
            let ny = scroll_top + offset;
            sum += fingerprint_diff(&prev_fp[py], &next_fp[ny]) as u64;
            rows += 1;
            offset += row_step;
        }
        let avg = (sum / rows.max(1)) as u32;
        coarse.push((avg, delta_y));
    }
    coarse.sort_unstable_by_key(|&(avg, delta)| (avg, delta));

    let mut best: Option<(u32, u32, usize)> = None;
    for &(_, delta_y) in coarse.iter().take(6) {
        let overlap = band_height - delta_y;
        let row_step = (overlap / 64).max(1);
        let mut sum = 0_u64;
        let mut rows = 0_u64;
        let mut offset = 0;
        while offset < overlap {
            sum += row_mean_diff(
                prev,
                scroll_top + delta_y + offset,
                next,
                scroll_top + offset,
                span,
            ) as u64;
            rows += 1;
            offset += row_step;
        }
        let avg = (sum / rows.max(1)) as u32;
        if avg > MAX_MATCH_CHANNEL_DIFF {
            continue;
        }
        let variance = band_row_variance(&next_fp, scroll_top, scroll_top + overlap);
        let better = match best {
            None => true,
            Some((best_avg, best_var, best_delta)) => {
                avg + 1 < best_avg
                    || (avg.abs_diff(best_avg) <= 1
                        && (variance > best_var || (variance == best_var && delta_y < best_delta)))
            }
        };
        if better {
            best = Some((avg, variance, delta_y));
        }
    }

    best.map(|(_, _, delta_y)| ScrollStep {
        scroll_top,
        scroll_bottom,
        delta_y,
    })
}

pub(super) fn stitch_frames(
    frames: &[RgbaFrame],
    max_height: usize,
    max_pixels: usize,
) -> Result<RgbaFrame, String> {
    let first = frames
        .first()
        .ok_or_else(|| "No capture frames were collected.".to_string())?;
    if first.width == 0 || first.height == 0 {
        return Err("Capture size exceeds the supported image limit.".into());
    }
    if frames.len() == 1 {
        return Ok(first.clone());
    }

    let width = first.width;
    let stride = width * 4;
    let mut canvas = Vec::new();
    let mut total_height = 0_usize;
    let mut last_footer: &[u8] = &[];
    let mut last_footer_rows = 0_usize;

    for pair in frames.windows(2) {
        let prev = &pair[0];
        let next = &pair[1];
        if next.width != width || next.height != first.height {
            break;
        }
        let Some(step) = find_scroll_overlap(prev, next) else {
            break;
        };
        if canvas.is_empty() {
            let head_rows = step.scroll_bottom;
            if head_rows > max_height || (head_rows as u64) * (width as u64) > max_pixels as u64 {
                return Ok(first.clone());
            }
            canvas.extend_from_slice(&prev.pixels[..head_rows * stride]);
            total_height = head_rows;
        }
        let next_footer_rows = next.height - step.scroll_bottom;
        let next_total = total_height + step.delta_y + next_footer_rows;
        if next_total > max_height || (next_total as u64) * (width as u64) > max_pixels as u64 {
            break;
        }
        let slice_start = (step.scroll_bottom - step.delta_y) * stride;
        let slice_end = step.scroll_bottom * stride;
        canvas.extend_from_slice(&next.pixels[slice_start..slice_end]);
        total_height += step.delta_y;
        last_footer = &next.pixels[slice_end..];
        last_footer_rows = next_footer_rows;
    }

    if canvas.is_empty() {
        return Ok(first.clone());
    }
    canvas.extend_from_slice(last_footer);
    total_height += last_footer_rows;

    Ok(RgbaFrame {
        width,
        height: total_height,
        pixels: canvas,
    })
}

fn send_wheel_down() -> bool {
    let input = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: 0,
                dy: 0,
                mouseData: (-(WHEEL_DELTA as i32) * SCROLL_NOTCHES) as u32,
                dwFlags: MOUSEEVENTF_WHEEL,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    unsafe { SendInput(1, &input, size_of::<INPUT>() as i32) == 1 }
}

pub(super) fn capture_scrolling_frames<C, V>(
    hwnd: HWND,
    rect: RECT,
    own_pid: u32,
    limits: ScrollLimits,
    window_pid: impl Fn(HWND) -> u32,
    verify_target: V,
    mut capture_frame: C,
) -> Result<Vec<RgbaFrame>, String>
where
    C: FnMut() -> Result<RgbaFrame, String>,
    V: Fn() -> bool,
{
    if !verify_target() {
        return Err("Capture target changed before capture. Focus it and retry.".into());
    }
    let current_fg = unsafe { GetForegroundWindow() };
    if current_fg != hwnd {
        if window_pid(current_fg) == own_pid {
            unsafe { SetForegroundWindow(hwnd) };
            std::thread::sleep(FOCUS_SETTLE_DELAY);
        }
        if unsafe { GetForegroundWindow() } != hwnd || !verify_target() {
            return Err("Focus the target window before starting scrolling capture.".into());
        }
    }

    let first = capture_frame()?;
    let width = first.width;
    let height = first.height;
    let mut frames = vec![first];
    let mut accumulated_height = height;

    let _cursor = CursorRestore::capture();
    let window_height = rect.bottom - rect.top;
    let center_x = rect.left + (rect.right - rect.left) / 2;
    let target_y = (rect.bottom - (window_height / 4).max(24))
        .clamp(rect.top + 8, (rect.bottom - 8).max(rect.top + 8));
    unsafe { SetCursorPos(center_x, target_y) };

    let started = Instant::now();
    for _ in 0..MAX_SCROLL_STEPS {
        if started.elapsed() >= MAX_SCROLL_DURATION {
            break;
        }
        if !verify_target() || unsafe { GetForegroundWindow() } != hwnd {
            return Err("Capture target changed before capture. Focus it and retry.".into());
        }
        if !send_wheel_down() {
            break;
        }
        std::thread::sleep(SCROLL_SETTLE_DELAY);
        if !verify_target() || unsafe { GetForegroundWindow() } != hwnd {
            return Err("Capture target changed before capture. Focus it and retry.".into());
        }
        let next = capture_frame()?;
        if next.width != width || next.height != height {
            break;
        }
        let Some(step) = find_scroll_overlap(frames.last().expect("non-empty frames"), &next)
        else {
            break;
        };
        let next_height = accumulated_height + step.delta_y;
        if next_height > limits.max_height
            || (next_height as u64) * (width as u64) > limits.max_pixels as u64
        {
            break;
        }
        accumulated_height = next_height;
        frames.push(next);
    }

    Ok(frames)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn synthetic_page(width: usize, total_height: usize) -> Vec<u8> {
        let mut pixels = vec![0_u8; width * total_height * 4];
        for y in 0..total_height {
            for x in 0..width {
                let idx = (y * width + x) * 4;
                let band = ((y / 20) * 37 + (x / 16) * 19) % 251;
                pixels[idx] = ((y * 3 + band) % 256) as u8;
                pixels[idx + 1] = ((y * 7 + x + band) % 256) as u8;
                pixels[idx + 2] = ((y * 11 + band * 2) % 256) as u8;
                pixels[idx + 3] = 255;
            }
        }
        pixels
    }

    fn viewport_slice(
        page: &[u8],
        width: usize,
        viewport_height: usize,
        offset_y: usize,
        header: usize,
        footer: usize,
        scrollbar_y: usize,
    ) -> RgbaFrame {
        let mut pixels = vec![0_u8; width * viewport_height * 4];
        for y in 0..viewport_height {
            for x in 0..width {
                let dst = (y * width + x) * 4;
                if x >= width - 12 {
                    let thumb = usize::from((scrollbar_y..scrollbar_y + 30).contains(&y));
                    pixels[dst] = if thumb == 1 { 180 } else { 30 };
                    pixels[dst + 1] = if thumb == 1 { 180 } else { 30 };
                    pixels[dst + 2] = if thumb == 1 { 180 } else { 30 };
                    pixels[dst + 3] = 255;
                    continue;
                }
                if y < header {
                    pixels[dst..dst + 4].copy_from_slice(&[24, 24, 28, 255]);
                } else if y >= viewport_height - footer {
                    pixels[dst..dst + 4].copy_from_slice(&[18, 18, 22, 255]);
                } else {
                    let src_y = offset_y + (y - header);
                    let src = (src_y * width + x) * 4;
                    pixels[dst..dst + 4].copy_from_slice(&page[src..src + 4]);
                }
            }
        }
        RgbaFrame {
            width,
            height: viewport_height,
            pixels,
        }
    }

    #[test]
    fn stitches_scrollable_frames_with_sticky_header_footer_and_scrollbar() {
        let width = 320;
        let viewport_height = 240;
        let header = 32;
        let footer = 20;
        let content_height = 500;
        let page = synthetic_page(width, content_height);

        let f0 = viewport_slice(&page, width, viewport_height, 0, header, footer, 40);
        let f1 = viewport_slice(&page, width, viewport_height, 90, header, footer, 90);
        let f2 = viewport_slice(&page, width, viewport_height, 180, header, footer, 140);

        let stitched = stitch_frames(&[f0.clone(), f1, f2], 4096, 24_000_000).unwrap();
        assert_eq!(stitched.width, width);
        assert_eq!(stitched.height, viewport_height + 180);

        for y in 0..header {
            assert_eq!(row_bytes(&stitched, y)[0], 24);
        }
        for y in stitched.height - footer..stitched.height {
            assert_eq!(row_bytes(&stitched, y)[0], 18);
        }
        let body_start = header;
        let body_rows = stitched.height - header - footer;
        for row in 0..body_rows {
            for x in 0..width - 12 {
                let actual = (body_start + row) * width * 4 + x * 4;
                let expected = row * width * 4 + x * 4;
                assert_eq!(
                    &stitched.pixels[actual..actual + 4],
                    &page[expected..expected + 4],
                    "mismatch at content row {row}, col {x}"
                );
            }
        }
    }

    #[test]
    fn identical_frames_stop_gracefully_with_single_frame() {
        let width = 160;
        let height = 120;
        let page = synthetic_page(width, height);
        let frame = viewport_slice(&page, width, height, 0, 16, 12, 20);
        assert!(find_scroll_overlap(&frame, &frame).is_none());
        let stitched = stitch_frames(&[frame.clone(), frame.clone()], 4096, 24_000_000).unwrap();
        assert_eq!(stitched, frame);
    }

    #[test]
    fn stitch_enforces_max_height_limit() {
        let width = 160;
        let viewport_height = 160;
        let page = synthetic_page(width, 400);
        let f0 = viewport_slice(&page, width, viewport_height, 0, 0, 0, 0);
        let f1 = viewport_slice(&page, width, viewport_height, 80, 0, 0, 0);
        let f2 = viewport_slice(&page, width, viewport_height, 160, 0, 0, 0);
        let stitched = stitch_frames(&[f0, f1, f2], 250, 24_000_000).unwrap();
        assert_eq!(stitched.height, 240);
    }
}
