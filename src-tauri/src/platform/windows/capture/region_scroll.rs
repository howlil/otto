use super::{region_state::RegionRect, scroll::RgbaFrame};

const STATIC_ROW_DIFF: u32 = 2;
const MAX_MATCH_CHANNEL_DIFF: u32 = 4;
const MIN_BAND_HEIGHT: usize = 32;
const MIN_SCROLL_DELTA: usize = 4;
const SCROLLBAR_GUARD_PX: usize = 24;
const FINGERPRINT_BUCKETS: usize = 16;
const MIN_CROP_EDGE: usize = 4;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct BandMatch {
    top: usize,
    bottom: usize,
    delta_y: usize,
    avg: u32,
    var: u32,
}

struct ScrollBand {
    top: usize,
    bottom: usize,
    offset: i32,
    doc_start: i32,
    doc_end: i32,
    pixels: Vec<u8>,
}

pub(super) struct RegionScrollCanvas {
    monitor: RegionRect,
    max_height: usize,
    max_pixels: usize,
    initial: RgbaFrame,
    latest: RgbaFrame,
    band: Option<ScrollBand>,
}

impl RegionScrollCanvas {
    pub(super) fn new(
        monitor: RegionRect,
        initial: RgbaFrame,
        max_height: usize,
        max_pixels: usize,
    ) -> Self {
        let latest = initial.clone();
        Self {
            monitor,
            max_height,
            max_pixels,
            initial,
            latest,
            band: None,
        }
    }

    pub(super) const fn monitor(&self) -> RegionRect {
        self.monitor
    }

    #[cfg(test)]
    pub(super) fn scrolled_offset(&self) -> i32 {
        self.band.as_ref().map_or(0, |b| b.offset)
    }

    pub(super) fn visual_anchor_y(&self, start_screen_y: i32) -> i32 {
        let Some(b) = &self.band else {
            return start_screen_y;
        };
        if self.initial.height == 0 {
            return start_screen_y;
        }
        let local_y =
            (start_screen_y - self.monitor.top).clamp(0, self.initial.height as i32) as usize;
        if (b.top..b.bottom).contains(&local_y) {
            (start_screen_y - b.offset).clamp(
                self.monitor.top + b.top as i32,
                self.monitor.top + b.bottom as i32,
            )
        } else {
            start_screen_y
        }
    }

    pub(super) fn push_frame(&mut self, next: RgbaFrame, wheel_hint: i16) -> bool {
        if next.width == 0
            || next.height == 0
            || next.width != self.latest.width
            || next.height != self.latest.height
        {
            return false;
        }
        let Some((c0, c1)) = active_column_span(&self.latest, &next) else {
            return false;
        };
        let bounds = self.band.as_ref().map(|b| (b.top, b.bottom));
        let down = find_band_overlap(&self.latest, &next, c0, c1, bounds);
        let up = find_band_overlap(&next, &self.latest, c0, c1, bounds);
        let Some((m, signed_delta)) = choose_direction(down, up, wheel_hint) else {
            return false;
        };
        if signed_delta == 0 {
            return false;
        }
        self.apply_scroll_step(&next, m.top, m.bottom, signed_delta);
        self.latest = next;
        true
    }

    fn apply_scroll_step(&mut self, next: &RgbaFrame, top: usize, bottom: usize, delta: i32) {
        let width = self.initial.width;
        let stride = width * 4;
        let b = self.band.get_or_insert_with(|| {
            let mut pixels = Vec::with_capacity((bottom - top) * stride);
            append_rows(&mut pixels, &self.initial, top, bottom);
            ScrollBand {
                top,
                bottom,
                offset: 0,
                doc_start: top as i32,
                doc_end: bottom as i32,
                pixels,
            }
        });
        let band_h = b.bottom.saturating_sub(b.top);
        if band_h == 0 || width == 0 {
            return;
        }
        let max_rows = self
            .max_height
            .min(self.max_pixels / width.max(1))
            .max(band_h);
        let next_off = b.offset + delta;
        let doc_top = b.top as i32 + next_off;
        let doc_bot = b.bottom as i32 + next_off;
        let cur_rows = (b.doc_end - b.doc_start) as usize;

        if delta > 0 && doc_bot > b.doc_end {
            let add = ((doc_bot - b.doc_end) as usize).min(band_h);
            let allow = add.min(max_rows.saturating_sub(cur_rows));
            if allow > 0 {
                let start = b.bottom - add;
                append_rows(&mut b.pixels, next, start, start + allow);
                b.doc_end += allow as i32;
            }
            b.offset = next_off.min(b.doc_end - b.bottom as i32);
        } else if delta < 0 && doc_top < b.doc_start {
            let add = ((b.doc_start - doc_top) as usize).min(band_h);
            let allow = add.min(max_rows.saturating_sub(cur_rows));
            if allow > 0 {
                let start = b.top + (add - allow);
                let mut pre = Vec::with_capacity(b.pixels.len() + allow * stride);
                append_rows(&mut pre, next, start, start + allow);
                pre.extend_from_slice(&b.pixels);
                b.pixels = pre;
                b.doc_start -= allow as i32;
            }
            b.offset = next_off.max(b.doc_start - b.top as i32);
        } else {
            b.offset = next_off.clamp(b.doc_start - b.top as i32, b.doc_end - b.bottom as i32);
            let off_rows = (b.top as i32 + b.offset - b.doc_start) as usize;
            for r in 0..band_h.min(cur_rows.saturating_sub(off_rows)) {
                let dst = (off_rows + r) * stride;
                b.pixels[dst..dst + stride].copy_from_slice(frame_row(next, b.top + r));
            }
        }
    }

    pub(super) fn crop_selection(&self, sx: i32, sy: i32, ex: i32, ey: i32) -> Option<RgbaFrame> {
        let b = self.band.as_ref()?;
        if b.offset == 0 || self.initial.width == 0 || self.initial.height == 0 {
            return None;
        }
        let x1 = (sx - self.monitor.left).clamp(0, self.initial.width as i32) as usize;
        let x2 = (ex - self.monitor.left).clamp(0, self.initial.width as i32) as usize;
        let (left, right) = if x1 <= x2 { (x1, x2) } else { (x2, x1) };
        let out_w = right.saturating_sub(left);
        if out_w < MIN_CROP_EDGE {
            return None;
        }
        let (h_top, h_body, h_bot) = (
            b.top,
            (b.doc_end - b.doc_start) as usize,
            self.latest.height.saturating_sub(b.bottom),
        );
        let map_y = |ly: usize, off: i32| -> usize {
            if ly < b.top {
                ly
            } else if ly < b.bottom {
                h_top + ((ly as i32 + off).clamp(b.doc_start, b.doc_end) - b.doc_start) as usize
            } else {
                h_top + h_body + (ly - b.bottom).min(h_bot)
            }
        };
        let u1 = map_y(
            (sy - self.monitor.top).clamp(0, self.initial.height as i32) as usize,
            0,
        );
        let u2 = map_y(
            (ey - self.monitor.top).clamp(0, self.latest.height as i32) as usize,
            b.offset,
        );
        let (u_top, u_bot) = if u1 <= u2 { (u1, u2) } else { (u2, u1) };
        let out_h = u_bot
            .saturating_sub(u_top)
            .min(self.max_height.min(self.max_pixels / out_w.max(1)));
        if out_h < MIN_CROP_EDGE {
            return None;
        }

        let (stride, b_left, b_right) = (self.initial.width * 4, left * 4, right * 4);
        let mut pixels = Vec::with_capacity(out_w * out_h * 4);
        for u in u_top..u_top + out_h {
            let slice = if u < h_top {
                &frame_row(&self.initial, u)[b_left..b_right]
            } else if u < h_top + h_body {
                let start = (u - h_top) * stride;
                &b.pixels[start + b_left..start + b_right]
            } else {
                &frame_row(&self.latest, b.bottom + (u - h_top - h_body))[b_left..b_right]
            };
            pixels.extend_from_slice(slice);
        }
        Some(RgbaFrame {
            width: out_w,
            height: out_h,
            pixels,
        })
    }
}

fn frame_row(f: &RgbaFrame, y: usize) -> &[u8] {
    &f.pixels[y * f.width * 4..(y + 1) * f.width * 4]
}

fn append_rows(target: &mut Vec<u8>, f: &RgbaFrame, start: usize, end: usize) {
    target.extend_from_slice(&f.pixels[start * f.width * 4..end * f.width * 4]);
}

fn active_column_span(prev: &RgbaFrame, next: &RgbaFrame) -> Option<(usize, usize)> {
    let (w, h) = (prev.width, prev.height);
    if w == 0 || h == 0 {
        return None;
    }
    let buckets = w.clamp(1, 64);
    let (bw, y_step) = ((w / buckets).max(1), (h / 48).max(1));
    let (mut first, mut last) = (None, None);
    for b in 0..buckets {
        let c0 = b * bw;
        let c1 = if b + 1 == buckets {
            w
        } else {
            ((b + 1) * bw).min(w)
        };
        let x_step = ((c1 - c0) / 4).max(1);
        let (mut sum, mut count) = (0_u64, 0_u64);
        for y in (0..h).step_by(y_step) {
            let (ra, rb) = (frame_row(prev, y), frame_row(next, y));
            for x in (c0..c1).step_by(x_step) {
                let i = x * 4;
                sum += ra[i].abs_diff(rb[i]) as u64
                    + ra[i + 1].abs_diff(rb[i + 1]) as u64
                    + ra[i + 2].abs_diff(rb[i + 2]) as u64;
                count += 3;
            }
        }
        if count > 0 && (sum / count) as u32 > STATIC_ROW_DIFF {
            first.get_or_insert(c0);
            last = Some(c1);
        }
    }
    let (start, mut end) = (first?, last?);
    if end <= start {
        return None;
    }
    if end - start > SCROLLBAR_GUARD_PX * 3 {
        end -= SCROLLBAR_GUARD_PX;
    }
    if end - start < 16 {
        return Some((0, w.saturating_sub(SCROLLBAR_GUARD_PX).max(w / 2)));
    }
    Some((start, end))
}

fn row_diff_span(a: &RgbaFrame, ay: usize, b: &RgbaFrame, by: usize, c0: usize, c1: usize) -> u32 {
    let (ra, rb, span) = (frame_row(a, ay), frame_row(b, by), c1.saturating_sub(c0));
    if span == 0 {
        return u32::MAX;
    }
    let (step, mut sum, mut count) = ((span / 96).max(1), 0_u64, 0_u64);
    for x in (c0..c1).step_by(step) {
        let i = x * 4;
        sum += ra[i].abs_diff(rb[i]) as u64
            + ra[i + 1].abs_diff(rb[i + 1]) as u64
            + ra[i + 2].abs_diff(rb[i + 2]) as u64;
        count += 3;
    }
    (sum / count.max(1)) as u32
}

fn fingerprints_span(f: &RgbaFrame, c0: usize, c1: usize) -> Vec<[u16; FINGERPRINT_BUCKETS]> {
    let bw = (c1.saturating_sub(c0).max(1) / FINGERPRINT_BUCKETS).max(1);
    let step = (bw / 4).max(1);
    (0..f.height)
        .map(|y| {
            let row = frame_row(f, y);
            let mut buckets = [0_u16; FINGERPRINT_BUCKETS];
            for (bi, slot) in buckets.iter_mut().enumerate() {
                let s = c0 + bi * bw;
                if s >= c1 {
                    break;
                }
                let (mut sum, mut count) = (0_u32, 0_u32);
                for x in (s..(s + bw).min(c1)).step_by(step) {
                    let i = x * 4;
                    sum += row[i] as u32 + row[i + 1] as u32 + row[i + 2] as u32;
                    count += 3;
                }
                *slot = sum.checked_div(count).unwrap_or(0) as u16;
            }
            buckets
        })
        .collect()
}

fn fp_diff(a: &[u16; FINGERPRINT_BUCKETS], b: &[u16; FINGERPRINT_BUCKETS]) -> u32 {
    a.iter()
        .zip(b)
        .map(|(l, r)| l.abs_diff(*r) as u32)
        .sum::<u32>()
        / FINGERPRINT_BUCKETS as u32
}

fn band_variance(fp: &[[u16; FINGERPRINT_BUCKETS]], start: usize, end: usize) -> u32 {
    if end <= start + 1 {
        return 0;
    }
    let step = ((end - start) / 24).max(1);
    (start..end - step).step_by(step).fold(0_u32, |acc, y| {
        acc.saturating_add(fp_diff(&fp[y], &fp[y + step]))
    })
}

fn find_band_overlap(
    prev: &RgbaFrame,
    next: &RgbaFrame,
    c0: usize,
    c1: usize,
    fixed: Option<(usize, usize)>,
) -> Option<BandMatch> {
    if c1 <= c0 {
        return None;
    }
    let (top, bottom) = fixed.unwrap_or_else(|| {
        let mut t = 0;
        while t < prev.height && row_diff_span(prev, t, next, t, c0, c1) <= STATIC_ROW_DIFF {
            t += 1;
        }
        let mut b = prev.height;
        while b > t && row_diff_span(prev, b - 1, next, b - 1, c0, c1) <= STATIC_ROW_DIFF {
            b -= 1;
        }
        (t, b)
    });
    let band_h = bottom.saturating_sub(top);
    if band_h < MIN_BAND_HEIGHT {
        return None;
    }
    let min_ov = (band_h / 6).clamp(16, 120).min(band_h - 1);
    let (min_d, max_d) = (MIN_SCROLL_DELTA.min(band_h - min_ov), band_h - min_ov);
    if min_d > max_d {
        return None;
    }

    let (pfp, nfp) = (
        fingerprints_span(prev, c0, c1),
        fingerprints_span(next, c0, c1),
    );
    let mut coarse: Vec<(u32, usize)> = (min_d..=max_d)
        .map(|dy| {
            let ov = band_h - dy;
            let step = (ov / 24).max(1);
            let (mut sum, mut rows) = (0_u64, 0_u64);
            for off in (0..ov).step_by(step) {
                sum += fp_diff(&pfp[top + dy + off], &nfp[top + off]) as u64;
                rows += 1;
            }
            ((sum / rows.max(1)) as u32, dy)
        })
        .collect();
    coarse.sort_unstable_by_key(|&(avg, dy)| (avg, dy));

    let mut best: Option<BandMatch> = None;
    for &(_, dy) in coarse.iter().take(6) {
        let ov = band_h - dy;
        let step = (ov / 64).max(1);
        let (mut sum, mut rows) = (0_u64, 0_u64);
        for off in (0..ov).step_by(step) {
            sum += row_diff_span(prev, top + dy + off, next, top + off, c0, c1) as u64;
            rows += 1;
        }
        let avg = (sum / rows.max(1)) as u32;
        if avg > MAX_MATCH_CHANNEL_DIFF {
            continue;
        }
        let cand = BandMatch {
            top,
            bottom,
            delta_y: dy,
            avg,
            var: band_variance(&nfp, top, top + ov),
        };
        let better = best.is_none_or(|cur| {
            cand.avg + 1 < cur.avg
                || (cand.avg.abs_diff(cur.avg) <= 1
                    && (cand.var > cur.var || (cand.var == cur.var && cand.delta_y < cur.delta_y)))
        });
        if better {
            best = Some(cand);
        }
    }
    best
}

fn choose_direction(
    down: Option<BandMatch>,
    up: Option<BandMatch>,
    hint: i16,
) -> Option<(BandMatch, i32)> {
    match (down, up) {
        (Some(d), None) => Some((d, d.delta_y as i32)),
        (None, Some(u)) => Some((u, -(u.delta_y as i32))),
        (Some(d), Some(u)) => {
            if d.avg + 1 < u.avg || (u.avg <= d.avg + 1 && hint <= 0) {
                Some((d, d.delta_y as i32))
            } else {
                Some((u, -(u.delta_y as i32)))
            }
        }
        (None, None) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn synthetic_document(width: usize, total_height: usize) -> Vec<u8> {
        let mut pixels = vec![0_u8; width * total_height * 4];
        for y in 0..total_height {
            for x in 0..width {
                let index = (y * width + x) * 4;
                let band = ((y / 14) * 41 + (x / 12) * 23) % 251;
                pixels[index] = ((y * 5 + band) % 256) as u8;
                pixels[index + 1] = ((y * 9 + x + band) % 256) as u8;
                pixels[index + 2] = ((y * 13 + band * 2) % 256) as u8;
                pixels[index + 3] = 255;
            }
        }
        pixels
    }

    fn render_monitor_frame(
        doc: &[u8],
        width: usize,
        viewport_height: usize,
        scroll_offset_y: usize,
        header: usize,
        footer: usize,
        sidebar_width: usize,
    ) -> RgbaFrame {
        let mut pixels = vec![0_u8; width * viewport_height * 4];
        for y in 0..viewport_height {
            for x in 0..width {
                let dst = (y * width + x) * 4;
                if x < sidebar_width {
                    pixels[dst..dst + 4].copy_from_slice(&[35, 38, 44, 255]);
                } else if x >= width - 12 {
                    let thumb_top = (scroll_offset_y / 3).min(viewport_height.saturating_sub(30));
                    let shade = if (thumb_top..thumb_top + 24).contains(&y) {
                        190
                    } else {
                        28
                    };
                    pixels[dst..dst + 4].copy_from_slice(&[shade, shade, shade, 255]);
                } else if y < header {
                    pixels[dst..dst + 4].copy_from_slice(&[20, 22, 26, 255]);
                } else if y >= viewport_height - footer {
                    pixels[dst..dst + 4].copy_from_slice(&[16, 18, 22, 255]);
                } else {
                    let doc_y = scroll_offset_y + (y - header);
                    let src = (doc_y * width + x) * 4;
                    pixels[dst..dst + 4].copy_from_slice(&doc[src..src + 4]);
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
    fn scrolling_down_keeps_x1y1_anchored_at_initial_content_and_stitches_to_x2y2() {
        let (width, viewport_height, header, footer, sidebar) = (320, 240, 28, 20, 48);
        let doc = synthetic_document(width, 700);
        let monitor = RegionRect {
            left: 0,
            top: 0,
            right: width as i32,
            bottom: viewport_height as i32,
        };
        let f0 = render_monitor_frame(&doc, width, viewport_height, 0, header, footer, sidebar);
        let f1 = render_monitor_frame(&doc, width, viewport_height, 80, header, footer, sidebar);
        let f2 = render_monitor_frame(&doc, width, viewport_height, 160, header, footer, sidebar);

        let mut canvas = RegionScrollCanvas::new(monitor, f0, 4096, 24_000_000);
        assert_eq!(canvas.visual_anchor_y(70), 70);
        assert!(canvas.push_frame(f1, -120));
        assert_eq!(canvas.scrolled_offset(), 80);
        assert_eq!(canvas.visual_anchor_y(70), 28);
        assert!(canvas.push_frame(f2, -120));
        assert_eq!(canvas.scrolled_offset(), 160);
        assert_eq!(canvas.visual_anchor_y(70), 28);

        let (start_x, start_y, end_x, end_y) = (80, 70, 260, 190);
        let cropped = canvas
            .crop_selection(start_x, start_y, end_x, end_y)
            .expect("scrolled region crop succeeds");

        let expected_w = (end_x - start_x) as usize;
        let expected_doc_start = start_y as usize - header;
        let expected_h = ((end_y as usize - header) + 160) - expected_doc_start;
        assert_eq!(cropped.width, expected_w);
        assert_eq!(cropped.height, expected_h);

        for row in 0..expected_h {
            let doc_y = expected_doc_start + row;
            for col in 0..expected_w {
                let doc_x = start_x as usize + col;
                let actual = (row * expected_w + col) * 4;
                let expected = (doc_y * width + doc_x) * 4;
                assert_eq!(
                    &cropped.pixels[actual..actual + 4],
                    &doc[expected..expected + 4],
                    "mismatch at stitched row {row}, col {col}"
                );
            }
        }
    }

    #[test]
    fn scrolling_down_then_partially_back_up_crops_exact_net_document_span() {
        let (width, viewport_height, header, footer) = (280, 220, 24, 16);
        let doc = synthetic_document(width, 600);
        let monitor = RegionRect {
            left: 100,
            top: 50,
            right: 100 + width as i32,
            bottom: 50 + viewport_height as i32,
        };
        let f0 = render_monitor_frame(&doc, width, viewport_height, 0, header, footer, 0);
        let f1 = render_monitor_frame(&doc, width, viewport_height, 90, header, footer, 0);
        let f2 = render_monitor_frame(&doc, width, viewport_height, 40, header, footer, 0);

        let mut canvas = RegionScrollCanvas::new(monitor, f0, 4096, 24_000_000);
        assert!(canvas.push_frame(f1, -120));
        assert_eq!(canvas.scrolled_offset(), 90);
        assert!(canvas.push_frame(f2, 120));
        assert_eq!(canvas.scrolled_offset(), 40);
        assert_eq!(canvas.visual_anchor_y(50 + 80), 50 + 40);

        let cropped = canvas
            .crop_selection(120, 50 + 80, 320, 50 + 180)
            .expect("net scroll crop succeeds");
        assert_eq!(cropped.width, 200);
        assert_eq!(cropped.height, (180 + 40) - 80);
    }
}
