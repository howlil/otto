# Changelog

All notable user-facing changes to Otto are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-11-21

### Breaking Changes
- Removed standalone Music, Pomodoro Focus, and OS-events shell modules; Otto is now a focused Personal AI Assistant & Learning Mentor desktop notch with a single Settings surface. Existing local conversation history (`conversations.json`) and shell preferences migrate automatically without data loss.

### Added
- Support for 19 locally installed AI CLI engines behind compiled adapters (Codex, Pi, OpenCode, Claude Code, and 15 ACP CLIs including Antigravity, Gemini CLI, GitHub Copilot, Qwen Code, Cursor Agent, Goose, Mistral Vibe, Amp, Kilo Code, Junie, Cline, Augment Code, Factory Droid, Grok Build, and Devin) with live Windows `Refresh PATH` discovery without restarting Otto.
- Six curated Learning Modes (`Direct`, `Solve` for math/logic/competitive programming, `Mentor`, `Simple`, `Write & Translate`, `Practice`) reachable via the composer pill and `/slash` commands, plus static **Profile & Learning Style** preferences.
- Clickable header Engine/Model/Thinking quick-switch popover with live 5-hour and weekly provider usage limits.
- Smart Capture 2.0: staged-first composer attachments with contextual Quick Actions, Windows native Region Snip (including live wheel-scroll stitching), `Ctrl+V` and drag-and-drop image staging, independent Selected Text and Visual Capture global shortcuts, composer camera source picker, and opt-in Instant Auto-Send.
- Conversation power and learning loop: up to 100 messages per conversation, Retry/Regenerate, inline Edit & re-run, single-slot follow-up queue while streaming, preserved partial answers marked `Stopped`, universal external-caret `Insert` on completed answers, post-answer learning follow-up chips (`Simpler`, `Give an example`, `Quiz me`, `Go deeper`), full-text History search, and Markdown export.
- Inline host permission choice card (`Decline & continue` / `Allow once`) for Codex and ACP host permission requests, correlated strictly by `request_id` with safe Decline/Cancel fallback on timeout, Stop, or disconnect.
- OpenCode (`-f`, `--session`, vision modality detection) and Claude Code (`--input-format stream-json` image input) multimodal and session parity, plus persistent Codex `app-server` multi-turn session reuse and reduced pre-turn readiness probes.
- Otto OS docked compact circle coexistence with state-change motion accents, semantic inner rim, and status pip.

### Changed
- Promoted the release channel from prerelease to stable SemVer (`1.0.0`) with curated `CHANGELOG.md` release notes, SHA-256 checksums, and minisign-signed Tauri updater artifacts (`latest.json`).
- Simplified assistant UI copy to warm, non-technical English with collapsible Thinking/activity trails and a five-section Settings sidebar (Assistant, Capture, Behavior, Position, General).

### Fixed
- Preserved already-streamed partial assistant text when stopping a run (`Stopped` status, `interrupted: true`), restored unstarted queued follow-ups back to the composer draft on Stop or error, and improved sanitized error diagnostics for authentication, rate limits, model availability, and network issues.

### Security
- Enforced zero auto-approval (`G8`) for all incoming CLI host permission requests and deterministic drop-based cleanup for ephemeral staged capture files without logging secrets or images.

[Unreleased]: https://github.com/howlil/otto/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/howlil/otto/compare/v0.3.1...v1.0.0
[0.3.1]: https://github.com/howlil/otto/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/howlil/otto/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/howlil/otto/releases/tag/v0.2.0
