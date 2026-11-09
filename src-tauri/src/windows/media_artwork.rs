use base64::{Engine, prelude::BASE64_STANDARD};
use windows::{
    Graphics::Imaging::BitmapDecoder,
    Storage::Streams::{DataReader, IRandomAccessStream},
};

pub fn read_artwork(
    properties: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
) -> Option<String> {
    let stream = properties
        .Thumbnail()
        .ok()?
        .OpenReadAsync()
        .ok()?
        .join()
        .ok()?;
    read_stream(&windows_core::Interface::cast(&stream).ok()?)
}

fn read_stream(stream: &IRandomAccessStream) -> Option<String> {
    let size = stream.Size().ok()?;
    if size == 0 || size > 2 * 1024 * 1024 {
        return None;
    }
    let decoder = BitmapDecoder::CreateAsync(stream).ok()?.join().ok()?;
    let width = decoder.PixelWidth().ok()?;
    let height = decoder.PixelHeight().ok()?;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 16_000_000 {
        return None;
    }
    let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0).ok()?).ok()?;
    let count = reader.LoadAsync(size as u32).ok()?.join().ok()?;
    if u64::from(count) != size {
        return None;
    }
    let mut bytes = vec![0; size as usize];
    reader.ReadBytes(&mut bytes).ok()?;
    let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        "image/jpeg"
    } else {
        return None;
    };
    Some(format!(
        "data:{mime};base64,{}",
        BASE64_STANDARD.encode(bytes)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::{
        Storage::{FileAccessMode, StorageFile},
        Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize, RoUninitialize},
    };

    #[test]
    fn native_artwork_stream_accepts_raster_and_rejects_invalid_or_oversized_content() {
        unsafe { RoInitialize(RO_INIT_MULTITHREADED).unwrap() };
        let mut png_bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png_bytes, 1, 1);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .write_header()
                .unwrap()
                .write_image_data(&[12, 24, 36, 255])
                .unwrap();
        }
        for (index, bytes) in [
            png_bytes,
            b"<svg><script>bad()</script></svg>".to_vec(),
            vec![0; 2 * 1024 * 1024 + 1],
        ]
        .into_iter()
        .enumerate()
        {
            let path = std::env::temp_dir()
                .join(format!("otto-artwork-{}-{index}.png", std::process::id()));
            std::fs::write(&path, bytes).unwrap();
            {
                let file = StorageFile::GetFileFromPathAsync(&windows_core::HSTRING::from(
                    path.to_string_lossy().as_ref(),
                ))
                .unwrap()
                .join()
                .unwrap();
                let stream = file
                    .OpenAsync(FileAccessMode::Read)
                    .unwrap()
                    .join()
                    .unwrap();
                let result = read_stream(&stream);
                if index == 0 {
                    assert!(result.unwrap().starts_with("data:image/png;base64,"));
                } else {
                    assert!(result.is_none());
                }
            }
            std::fs::remove_file(path).unwrap();
        }
        unsafe { RoUninitialize() };
    }
}
