use super::{readiness::executable, stream::valid_session_id};
use crate::agent::CapturedImage;
use crate::agent::providers::{BoundedLineError, encode_png_capture, transport::JsonlProcess};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

pub(super) fn launch_args(
    session: Option<&str>,
    model: Option<&str>,
    thinking_effort: Option<&str>,
) -> Vec<String> {
    let mut args = vec![
        "-p".into(),
        "--input-format".into(),
        "stream-json".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--include-partial-messages".into(),
    ];
    if let Some(session) = session {
        args.extend(["--resume".into(), session.into()]);
    }
    if let Some(model) = model {
        args.extend(["--model".into(), model.into()]);
    }
    if let Some(effort) = thinking_effort {
        args.extend(["--effort".into(), effort.into()]);
    }
    args
}

pub(super) fn user_message_frame(text: &str, base64_png: Option<&str>) -> Value {
    let content = match base64_png {
        Some(encoded) => json!([
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": encoded
                }
            },
            {
                "type": "text",
                "text": text
            }
        ]),
        None => json!([{ "type": "text", "text": text }]),
    };
    json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": content
        }
    })
}

pub(super) async fn prepare_input_payload(
    text: &str,
    capture: Option<&CapturedImage>,
) -> Result<Vec<u8>, String> {
    let encoded = match capture {
        Some(image) => {
            let path = image.path().to_owned();
            Some(
                tokio::task::spawn_blocking(move || encode_png_capture(&path))
                    .await
                    .map_err(|_| "Image preparation was interrupted.".to_string())??,
            )
        }
        None => None,
    };
    serde_json::to_vec(&user_message_frame(text, encoded.as_deref()))
        .map_err(|_| "Could not encode the Claude Code request.".to_string())
}

pub(super) fn bounded_line_error(error: BoundedLineError) -> &'static str {
    match error {
        BoundedLineError::TooLarge => "Claude Code response exceeded the frame limit.",
        BoundedLineError::InvalidUtf8 => "Claude Code returned invalid text.",
        BoundedLineError::Read => "Claude Code output failed.",
    }
}

pub(super) struct PersistentClaude {
    pub(super) process: JsonlProcess,
    cwd: PathBuf,
    model: Option<String>,
    thinking_effort: Option<String>,
}

impl PersistentClaude {
    pub(super) fn spawn(
        cwd: &Path,
        session: Option<&str>,
        model: Option<&str>,
        thinking_effort: Option<&str>,
    ) -> Result<Self, String> {
        let Some(binary) = executable() else {
            return Err("Claude Code was not found in PATH.".into());
        };
        let args = launch_args(
            session.filter(|id| valid_session_id(id)),
            model,
            thinking_effort,
        );
        let (process, _) = JsonlProcess::launch(
            "Claude Code",
            &binary,
            args,
            cwd,
            false,
            "Claude Code could not start.",
        )?;
        Ok(Self {
            process,
            cwd: cwd.to_path_buf(),
            model: model.map(str::to_owned),
            thinking_effort: thinking_effort.map(str::to_owned),
        })
    }

    pub(super) fn matches(
        &self,
        cwd: &Path,
        model: Option<&str>,
        thinking_effort: Option<&str>,
    ) -> bool {
        self.cwd.as_path() == cwd
            && self.model.as_deref() == model
            && self.thinking_effort.as_deref() == thinking_effort
    }

    pub(super) async fn terminate(&mut self) {
        self.process.terminate_tree().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_launch_args_use_persistent_stream_json_without_tool_or_permission_overrides() {
        let args = launch_args(Some("sess-1"), Some("claude-sonnet-5-5"), Some("high"));
        assert_eq!(
            args,
            vec![
                "-p",
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--verbose",
                "--include-partial-messages",
                "--resume",
                "sess-1",
                "--model",
                "claude-sonnet-5-5",
                "--effort",
                "high",
            ]
        );
        for forbidden in [
            "--tools",
            "--allowedTools",
            "--disallowedTools",
            "--permission-mode",
            "--dangerously-skip-permissions",
            "--bare",
        ] {
            assert!(!args.iter().any(|arg| arg == forbidden));
        }
    }

    #[test]
    fn claude_user_message_frame_supports_text_and_multimodal_images() {
        let text_frame = user_message_frame("hy", None);
        assert_eq!(text_frame["type"], "user");
        assert_eq!(text_frame["message"]["role"], "user");
        assert_eq!(text_frame["message"]["content"][0]["type"], "text");
        assert_eq!(text_frame["message"]["content"][0]["text"], "hy");

        let frame = user_message_frame("Solve problem 3", Some("iVBORw0KGgo="));
        assert_eq!(frame["type"], "user");
        assert_eq!(frame["message"]["content"][0]["type"], "image");
        assert_eq!(frame["message"]["content"][0]["source"]["type"], "base64");
        assert_eq!(
            frame["message"]["content"][0]["source"]["media_type"],
            "image/png"
        );
        assert_eq!(
            frame["message"]["content"][0]["source"]["data"],
            "iVBORw0KGgo="
        );
        assert_eq!(frame["message"]["content"][1]["type"], "text");
        assert_eq!(frame["message"]["content"][1]["text"], "Solve problem 3");
    }
}
