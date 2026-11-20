use base64::{Engine as _, engine::general_purpose::STANDARD};
use std::{
    fs::OpenOptions,
    io::{Cursor, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_CAPTURE_BYTES: u64 = 24 * 1024 * 1024;
const MAX_CAPTURE_EDGE: u32 = 1920;
const MAX_SCROLL_CAPTURE_HEIGHT: u32 = 8192;
const MAX_ENCODED_CAPTURE_BYTES: usize = 4 * 1024 * 1024;
const MAX_DECODED_CAPTURE_BYTES: usize = 256 * 1024 * 1024;
const PNG_MAGIC: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];
const STAGED_FILE_PREFIX: &str = "otto-capture-";

pub(in crate::agent) fn stage_base64_png(
    encoded: &str,
) -> Result<(crate::agent::CapturedImage, u32, u32), String> {
    let trimmed = encoded.trim();
    let raw_base64 = trimmed
        .strip_prefix("data:image/png;base64,")
        .unwrap_or(trimmed)
        .trim();
    if raw_base64.is_empty() {
        return Err("Pasted image is empty.".into());
    }
    let bytes = STANDARD
        .decode(raw_base64)
        .map_err(|_| "Pasted image is not valid base64 PNG data.".to_string())?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_CAPTURE_BYTES {
        return Err("Pasted image exceeds the supported size limit.".into());
    }
    if !bytes.starts_with(&PNG_MAGIC) {
        return Err("Pasted image is not a valid supported PNG.".into());
    }
    let payload = if bytes.len() <= MAX_ENCODED_CAPTURE_BYTES && png_is_within_edge(&bytes)? {
        bytes
    } else {
        normalize_png_capture(&bytes)?
    };
    if payload.len() > MAX_ENCODED_CAPTURE_BYTES {
        return Err("Pasted image could not be reduced to the supported size.".into());
    }
    let (width, height) = png_dimensions(&payload)?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "Cannot create a unique capture file.".to_string())?
        .as_nanos();
    let path: PathBuf = std::env::temp_dir().join(format!(
        "{STAGED_FILE_PREFIX}{}-{nonce}.png",
        std::process::id()
    ));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&path)
        .map_err(|_| "Cannot create the temporary staged image.".to_string())?;
    let image = crate::agent::CapturedImage::new(path);
    file.write_all(&payload)
        .map_err(|_| "Cannot write the temporary staged image.".to_string())?;
    Ok((image, width, height))
}

fn png_dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    let decoder = png::Decoder::new(Cursor::new(bytes));
    let reader = decoder
        .read_info()
        .map_err(|_| "Captured image is not a valid supported PNG.".to_string())?;
    let info = reader.info();
    if info.width == 0 || info.height == 0 {
        return Err("Captured image has invalid dimensions.".into());
    }
    Ok((info.width, info.height))
}

pub(in crate::agent::providers) fn encode_png_capture(path: &Path) -> Result<String, String> {
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
    if info.width == 0 || info.height == 0 {
        return Err("Captured image is not a supported RGBA PNG.".into());
    }
    let expected_bytes = u64::from(info.width)
        .checked_mul(u64::from(info.height))
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or("Captured image exceeds the supported decoded size.")?;
    if expected_bytes > MAX_DECODED_CAPTURE_BYTES as u64 {
        return Err("Captured image exceeds the supported decoded size.".into());
    }
    let buffer_size = reader
        .output_buffer_size()
        .filter(|size| *size <= MAX_DECODED_CAPTURE_BYTES)
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
        let source_y = ((u64::from(y) * u64::from(source_height)) / u64::from(height)) as usize;
        for x in 0..width {
            let source_x = ((u64::from(x) * u64::from(source_width)) / u64::from(width)) as usize;
            let source_index = (source_y * source_width as usize + source_x) * 4;
            let target_index = (y as usize * width as usize + x as usize) * 4;
            resized[target_index..target_index + 4]
                .copy_from_slice(&source[source_index..source_index + 4]);
        }
    }
    resized
}

#[cfg(test)]
mod tests {
    use super::*;

    fn minimal_rgba_png_header(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&[137, 80, 78, 71, 13, 10, 26, 10]);
        let mut ihdr = Vec::with_capacity(17);
        ihdr.extend_from_slice(b"IHDR");
        ihdr.extend_from_slice(&width.to_be_bytes());
        ihdr.extend_from_slice(&height.to_be_bytes());
        ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);
        bytes.extend_from_slice(&13u32.to_be_bytes());
        bytes.extend_from_slice(&ihdr);
        bytes.extend_from_slice(&crc32fast_ieee(&ihdr).to_be_bytes());
        bytes.extend_from_slice(&0u32.to_be_bytes());
        bytes.extend_from_slice(b"IDAT");
        bytes.extend_from_slice(&crc32fast_ieee(b"IDAT").to_be_bytes());
        bytes.extend_from_slice(&[0, 0, 0, 0, b'I', b'E', b'N', b'D', 174, 66, 96, 130]);
        bytes
    }

    fn crc32fast_ieee(data: &[u8]) -> u32 {
        let mut crc = 0xffff_ffffu32;
        for &byte in data {
            crc ^= u32::from(byte);
            for _ in 0..8 {
                let mask = (crc & 1).wrapping_neg();
                crc = (crc >> 1) ^ (0xedb8_8320 & mask);
            }
        }
        !crc
    }

    #[test]
    fn normalize_png_capture_rejects_oversized_dimensions_before_allocating() {
        let png = minimal_rgba_png_header(10_000, 10_000);
        let err = normalize_png_capture(&png).unwrap_err();
        assert!(err.contains("exceeds the supported decoded size"));
    }

    #[test]
    fn stage_base64_png_creates_ephemeral_file_and_deletes_on_drop() {
        let mut raw_png = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut raw_png, 2, 2);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(&[255u8; 16]).unwrap();
        }
        let encoded = format!("data:image/png;base64,{}", STANDARD.encode(&raw_png));
        let (image, width, height) = stage_base64_png(&encoded).expect("valid PNG should stage");
        assert_eq!((width, height), (2, 2));
        let path = image.path().to_path_buf();
        assert!(path.exists());
        drop(image);
        assert!(!path.exists());

        assert!(stage_base64_png("").is_err());
        assert!(stage_base64_png(&STANDARD.encode(b"not-a-png")).is_err());
    }
}
