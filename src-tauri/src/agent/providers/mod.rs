#[cfg(all(test, windows))]
mod acceptance;

use base64::{Engine as _, engine::general_purpose::STANDARD};
use std::{io::Cursor, path::Path};
use tokio::io::{AsyncBufRead, AsyncBufReadExt};

const MAX_CAPTURE_BYTES: u64 = 24 * 1024 * 1024;
const MAX_CAPTURE_EDGE: u32 = 1920;
const MAX_SCROLL_CAPTURE_HEIGHT: u32 = 8192;
const MAX_ENCODED_CAPTURE_BYTES: usize = 4 * 1024 * 1024;
const PNG_MAGIC: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];

pub(super) fn encode_png_capture(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|_| "Cannot read captured image.".to_string())?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_CAPTURE_BYTES {
        return Err("Captured image exceeds the supported size limit.".into());
    }
    if !bytes.starts_with(&PNG_MAGIC) {
        return Err("Captured image is not a valid supported PNG.".into());
    }
    let payload = if bytes.len() <= MAX_ENCODED_CAPTURE_BYTES && png_is_within_edge(&bytes)? {
        bytes
    } else {
        normalize_png_capture(&bytes)?
    };
    if payload.len() > MAX_ENCODED_CAPTURE_BYTES {
        return Err("Captured image could not be reduced to the supported size.".into());
    }
    Ok(STANDARD.encode(payload))
}

fn png_is_within_edge(bytes: &[u8]) -> Result<bool, String> {
    let decoder = png::Decoder::new(Cursor::new(bytes));
    let reader = decoder
        .read_info()
        .map_err(|_| "Captured image is not a valid supported PNG.".to_string())?;
    Ok(
        reader.info().width <= MAX_CAPTURE_EDGE
            && reader.info().height <= MAX_SCROLL_CAPTURE_HEIGHT,
    )
}

fn normalize_png_capture(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let decoder = png::Decoder::new(Cursor::new(bytes));
    let mut reader = decoder
        .read_info()
        .map_err(|_| "Captured image is not a valid supported PNG.".to_string())?;
    let info = reader.info();
    if info.color_type != png::ColorType::Rgba || info.bit_depth != png::BitDepth::Eight {
        return Err("Captured image is not a supported RGBA PNG.".into());
    }
    let buffer_size = reader
        .output_buffer_size()
        .ok_or("Captured image exceeds the supported decoded size.")?;
    let mut decoded = vec![0; buffer_size];
    let frame = reader
        .next_frame(&mut decoded)
        .map_err(|_| "Captured image could not be decoded.".to_string())?;
    let source = &decoded[..frame.buffer_size()];
    let width_scale = MAX_CAPTURE_EDGE as f64 / frame.width as f64;
    let height_scale = MAX_SCROLL_CAPTURE_HEIGHT as f64 / frame.height as f64;
    let mut scale = width_scale.min(height_scale).min(1.0);
    for _ in 0..6 {
        let width = (frame.width as f64 * scale).round().max(1.0) as u32;
        let height = (frame.height as f64 * scale).round().max(1.0) as u32;
        let resized = resize_rgba(source, frame.width, frame.height, width, height);
        let mut output = Vec::new();
        let mut encoder = png::Encoder::new(&mut output, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::Balanced);
        encoder
            .write_header()
            .and_then(|mut writer| writer.write_image_data(&resized))
            .map_err(|_| "Captured image could not be encoded.".to_string())?;
        if output.len() <= MAX_ENCODED_CAPTURE_BYTES {
            return Ok(output);
        }
        scale *= 0.8;
    }
    Err("Captured image could not be reduced to the supported size.".into())
}

fn resize_rgba(
    source: &[u8],
    source_width: u32,
    source_height: u32,
    width: u32,
    height: u32,
) -> Vec<u8> {
    let mut resized = vec![0; width as usize * height as usize * 4];
    for y in 0..height {
        let source_y = (y * source_height / height) as usize;
        for x in 0..width {
            let source_x = (x * source_width / width) as usize;
            let source_index = (source_y * source_width as usize + source_x) * 4;
            let target_index = (y as usize * width as usize + x as usize) * 4;
            resized[target_index..target_index + 4]
                .copy_from_slice(&source[source_index..source_index + 4]);
        }
    }
    resized
}

pub(crate) fn authentication_required(detail: &str) -> bool {
    let detail = detail.to_ascii_lowercase();
    [
        "sign in",
        "sign-in",
        "not signed in",
        "log in",
        "login",
        "not authenticated",
        "authentication required",
        "unauthorized",
        "invalid credentials",
        "expired credentials",
        "token expired",
    ]
    .iter()
    .any(|signal| detail.contains(signal))
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum BoundedLineError {
    Read,
    TooLarge,
    InvalidUtf8,
}

pub(crate) async fn read_bounded_line<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    max_bytes: usize,
) -> Result<Option<String>, BoundedLineError> {
    let mut line = Vec::new();
    let mut ended = false;

    loop {
        let buffer = reader
            .fill_buf()
            .await
            .map_err(|_| BoundedLineError::Read)?;
        if buffer.is_empty() {
            break;
        }

        let newline = buffer.iter().position(|byte| *byte == b'\n');
        let mut payload_length = newline.unwrap_or(buffer.len());
        if newline.is_some() && payload_length > 0 && buffer[payload_length - 1] == b'\r' {
            payload_length = payload_length.saturating_sub(1);
        }
        if newline == Some(0) && line.last() == Some(&b'\r') {
            line.pop();
        }
        if line.len().saturating_add(payload_length) > max_bytes {
            return Err(BoundedLineError::TooLarge);
        }
        line.extend_from_slice(&buffer[..payload_length]);
        reader.consume(newline.map_or(payload_length, |index| index + 1));

        if newline.is_some() {
            ended = true;
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            break;
        }
    }

    if !ended && line.is_empty() {
        return Ok(None);
    }

    String::from_utf8(line)
        .map(Some)
        .map_err(|_| BoundedLineError::InvalidUtf8)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_signals_are_recognized_from_provider_detail() {
        assert!(authentication_required("401 Unauthorized: token expired"));
        assert!(authentication_required("Please log in again"));
        assert!(!authentication_required("rate limit reached"));
        assert!(!authentication_required(""));
    }
    use tokio::io::BufReader;

    #[tokio::test]
    async fn bounded_line_reader_preserves_frames_and_eof() {
        let mut reader = BufReader::new(&b"one\r\ntwo"[..]);
        assert_eq!(
            read_bounded_line(&mut reader, 3).await,
            Ok(Some("one".into()))
        );
        assert_eq!(
            read_bounded_line(&mut reader, 3).await,
            Ok(Some("two".into()))
        );
        assert_eq!(read_bounded_line(&mut reader, 3).await, Ok(None));
    }

    #[tokio::test]
    async fn bounded_line_reader_rejects_large_or_invalid_frames() {
        let mut oversized = BufReader::new(&b"1234\n"[..]);
        assert_eq!(
            read_bounded_line(&mut oversized, 3).await,
            Err(BoundedLineError::TooLarge)
        );

        let mut invalid = BufReader::new(&[0xff, b'\n'][..]);
        assert_eq!(
            read_bounded_line(&mut invalid, 1).await,
            Err(BoundedLineError::InvalidUtf8)
        );
    }

    #[test]
    fn encode_png_capture_preserves_tall_scrolling_resolution() {
        let path =
            std::env::temp_dir().join(format!("otto-tall-capture-{}.png", std::process::id()));
        let width = 800_u32;
        let height = 3000_u32;
        let pixels = vec![120_u8; width as usize * height as usize * 4];
        let file = std::fs::File::create(&path).unwrap();
        let mut encoder = png::Encoder::new(file, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&pixels).unwrap();
        drop(writer);

        let encoded = encode_png_capture(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        let decoded_png = STANDARD.decode(encoded).unwrap();
        let reader = png::Decoder::new(Cursor::new(decoded_png))
            .read_info()
            .unwrap();
        assert_eq!(reader.info().width, 800);
        assert_eq!(reader.info().height, 3000);
    }
}

#[cfg(windows)]
pub mod agy;
pub mod codex;
#[cfg(windows)]
mod job;
#[cfg(windows)]
pub mod opencode;
#[cfg(windows)]
pub mod pi;
pub mod registry;
mod transport;
