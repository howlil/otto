use tokio::io::{AsyncBufRead, AsyncBufReadExt};

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
}

#[cfg(windows)]
pub mod agy;
pub mod codex;
#[cfg(windows)]
mod job;
#[cfg(windows)]
pub mod pi;
pub mod registry;
