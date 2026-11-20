<div align="center">
  <img src="src-tauri/icons/icon.png" alt="Otto" width="76" />
  <h1>Otto</h1>
  <p>
    <strong>A quiet Windows desktop notch — Personal AI Assistant &amp; Learning Mentor powered 100% by your local AI CLI engines.</strong>
  </p>
  <p>
    <a href="https://github.com/howlil/otto/releases/latest">
      <img src="https://img.shields.io/github/v/release/howlil/otto?style=flat-square&label=release&color=111111" alt="Latest Release" />
    </a>
    <a href="https://github.com/howlil/otto/actions/workflows/otto-verify-once.yml">
      <img src="https://img.shields.io/github/actions/workflow/status/howlil/otto/otto-verify-once.yml?style=flat-square&label=CI" alt="Otto CI" />
    </a>
    <a href="https://github.com/howlil/otto/actions/workflows/release.yml">
      <img src="https://img.shields.io/github/actions/workflow/status/howlil/otto/release.yml?style=flat-square&label=Release" alt="Otto Release" />
    </a>
    <img src="https://img.shields.io/badge/platform-Windows%2011-0078D4?style=flat-square" alt="Platform Windows 11" />
    <img src="https://img.shields.io/badge/stack-Tauri%202%20%C2%B7%20Rust%20%C2%B7%20React%2019-24292F?style=flat-square" alt="Tauri 2 Rust React 19" />
  </p>
  <p>
    <a href="https://github.com/howlil/otto/releases/latest"><strong>Download Installer (v1.0.0)</strong></a>
    &nbsp;·&nbsp;
    <a href="#quick-start">Quick Start</a>
    &nbsp;·&nbsp;
    <a href="#supported-cli-engines-19">19 AI CLIs</a>
    &nbsp;·&nbsp;
    <a href="#learning-modes--slash-commands">Learning Modes</a>
    &nbsp;·&nbsp;
    <a href="CHANGELOG.md">Changelog</a>
  </p>
</div>

---

## Why Otto?

Otto sits quietly at the top edge of your Windows desktop — ready when you study, read, solve hard problems, or write, and invisible the moment you return to work.

- **Zero extra API keys or subscriptions** — reuses the AI CLI tools already installed and authenticated on your PC (`codex`, `claude`, `opencode`, `pi`, and 15 ACP CLIs).
- **Never breaks your flow** — hover previews without stealing keyboard focus; click or press `Ctrl+Alt+O` to pin; collapse mid-stream while answers continue in the background. Supports **Floating**, **Top-Attached** (with curved shoulders), and docked **Otto OS Compact Circle** modes with live state-change motion cues.
- **Designed for deep learning & problem solving** — six curated Learning Modes (including `/solve` for math, logic, and competitive programming), staged Smart Capture 2.0, and universal caret **Insert** straight back into your active app.
- **Privacy & explicit consent first** — screen capture runs only on explicit user trigger, Hide-from-Screen-Capture defaults **ON**, no secrets or screenshots are ever written to history, and CLI host permission prompts are **never auto-approved**.

---

## Quick Start

### 1. Install Otto on Windows 11
Download the latest Windows installer (`Otto_1.0.0_x64-setup.exe`) from [**GitHub Releases**](https://github.com/howlil/otto/releases/latest).

- Installs quietly in **current-user scope** (no admin prompt required).
- Includes automatic **minisign-verified** in-app updates (checked on launch and every 6 hours via Settings → General).
- *Note:* The installer is not yet Authenticode-signed for Windows SmartScreen; click **More info → Run anyway** on first install if prompted, or verify against `SHA256SUMS.txt` on the release page.

### 2. Have at least one local AI CLI signed in
Install and sign in to any supported engine (for example `codex login`, `claude auth login`, `opencode auth login`, `pi`, or any ACP CLI below). Installed CLIs are auto-detected from `PATH` — and if you install a new CLI while Otto is open, click **Refresh PATH** in **Settings → Assistant** without restarting.

### 3. Open and ask
Hover the top notch to preview, click it, or press `Ctrl+Alt+O` from anywhere.

---

## Key Capabilities

### Learning Modes & Slash Commands

Switch modes from the composer pill or type a `/slash` command inline (e.g. `/solve Find the minimum number of operations...`):

| Mode | Slash Trigger | Aliases | Best For |
| --- | --- | --- | --- |
| **Direct** | `/direct` | `/fast`, `/answer` | Clear, concise answers without filler |
| **Solve** | `/solve` | `/math`, `/logic`, `/cp`, `/algo`, `/verify` | Complex math, logic, science, multiple-choice & optimal competitive programming with verification |
| **Mentor** | `/mentor` | `/coach`, `/guide`, `/socratic` | Step-by-step explanations and guided Socratic questions |
| **Simple** | `/simple` | `/eli5`, `/easy`, `/explain` | Plain-language breakdowns and everyday analogies |
| **Write & Translate** | `/write` | `/translate`, `/rewrite`, `/polish` | Drafting, rewriting, tone polishing & translation |
| **Practice** | `/practice` | `/quiz`, `/drill`, `/test` | Short recall drills and comprehension checks |

Configure a static **Profile & Learning Style** (preferred answer language, depth/level, and brief instructions) in **Settings → Assistant** so every engine adapts to how you learn.

### Smart Capture 2.0 & Universal Insert

- **Staged-first composer attachments** — captured regions, windows, full screens, selected text, and pasted/dropped images (`Ctrl+V`) appear as removable chips with one-click contextual Quick Actions (`Explain`, `Solve`, `Break down`, `Translate`, `Summarize`, `Quiz me`, `Rewrite`). Enable **Instant auto-send** in **Settings → Capture** if you prefer one-keystroke submission.
- **Native Region Snip + Live Scroll Stitching** — draw a hollow, capture-excluded region anywhere on screen, or scroll the wheel while dragging to stitch long pages seamlessly.
- **Clipboard-free Selected Text Capture** — reads highlighted text via Windows UI Automation without touching your clipboard.
- **Universal Caret Insert** — click **Insert** on any completed answer to type clean Markdown-stripped text directly at the last focused external caret (never overwrites your clipboard).

### Conversation Power & Rich Answers

- **Rich Markdown, Math & Code** — renders GFM tables, task lists, KaTeX math (`$...$` / `$$...$$`), and syntax-highlighted code blocks with per-block **Copy code** (strictly sanitized — raw HTML/script is never executed and remote images are never fetched).
- **Full Turn Controls** — **Retry / Regenerate**, inline **Edit prompt & re-run**, single-slot **Queue follow-up** while streaming (auto-restores to draft if stopped or failed), and **Stop** that preserves already-streamed partial text marked `Stopped`.
- **Learning Loop** — one-click follow-up chips (**Simpler**, **Give an example**, **Quiz me**, **Go deeper**) beneath the latest completed answer, plus collapsible **Thinking** and non-technical activity trails.
- **Local Searchable History** — stores up to **200 conversations** and **100 messages per conversation** locally with full-text search, rename, delete, cross-engine continuation, and **Export Markdown** to clipboard.
- **Header Quick Switcher** — click the header Engine/Model label anytime to switch Engine, Model, Thinking effort, or inspect live 5-hour and weekly provider usage limits without leaving chat.

### Safety & Graceful Host Permissions

Otto has **no file-edit executor, no shell executor, and no coding workspace picker**. Each CLI keeps its own native authentication, configuration, and tool policies without Otto injecting override flags.

When an engine (Codex or any ACP CLI) asks for a host permission decision mid-turn, Otto pauses cleanly and renders an inline choice card (**Decline & continue** / **Allow once**) correlated strictly by `request_id`:
- **Zero auto-approval** — every `Allow once` requires an explicit click.
- **Fail-safe default** — 120-second timeout, `Stop`, window close, or disconnect always replies **Decline / Cancel**.

---

## Supported CLI Engines (19)

Otto ships 19 statically compiled adapters — zero runtime plugin loaders and zero hidden `npx`/`uvx` downloads.

### Dedicated Protocol Adapters
| Engine | Command | Highlights |
| --- | --- | --- |
| **Codex** | `codex` | Persistent `app-server` multi-turn threads, image input, reasoning effort, live 5h/weekly usage limits, inline host permissions |
| **Claude Code** | `claude` | Native catalog & effort discovery, `--resume` multi-turn sessions, `--input-format stream-json` multimodal image input, live rate limits |
| **OpenCode** | `opencode` | `models --verbose` context/variant/vision probing, `--session` multi-turn reuse, `-f` image attachments |
| **Pi** | `pi` | Persistent JSONL RPC session, nested model catalogs, thinking levels, Base64 PNG image prompts, session usage stats |

### Universal ACP Adapters (15 CLIs)
All ACP engines share Otto's persistent `stdio` ACP runtime with model/thinking configuration, image support where advertised by the runtime, live activity trails, and inline host permission cards:

| Engine | Command | Engine | Command | Engine | Command |
| --- | --- | --- | --- | --- | --- |
| **Agy (Antigravity)** | `agy` | **Goose** | `goose` | **Cline** | `cline` |
| **Gemini CLI** | `gemini` | **Mistral Vibe** | `vibe-acp` | **Augment Code** | `auggie` |
| **GitHub Copilot** | `copilot` | **Amp** | `amp-acp` | **Factory Droid** | `droid` |
| **Qwen Code** | `qwen` | **Kilo Code** | `kilo` | **Grok Build** | `grok` |
| **Cursor Agent** | `agent` | **Junie** | `junie` | **Devin** | `devin` |

---

## Default Keyboard Shortcuts

All global shortcuts can be customized immediately in **Settings → Behavior** and **Settings → Capture**.

| Shortcut | Action |
| --- | --- |
| `Ctrl+Alt+O` | Expand / collapse Otto from anywhere |
| `Ctrl+Shift+O` | Visual Capture (Region Snip, Window, Scrolling Window, or Full Screen) |
| `Ctrl+Shift+T` | Selected Text Capture (via Windows UI Automation) |
| `Ctrl+V` | Stage an image from clipboard directly into the composer |
| `Enter` / `Shift+Enter` | Send prompt (or queue follow-up while streaming) / insert newline |
| `Esc` | Close active popover, cancel snip/edit, or collapse Otto to Compact |

---

## Architecture

Otto is a Windows-first **Tauri 2 modular monolith** with strict unidirectional boundaries enforced automatically by `bun run check`:

```text
K1  React 19 + TypeScript 6 + Tailwind CSS 4    (src/app, src/features/{agent,shell}, src/shared/ui)
      │  typed IPC & Channel projections
      ▼
K2  Tauri Host & IPC Adapters                   (src-tauri/src/ipc, src-tauri/src/shell)
      │  validated commands & snapshot fan-out
      ▼
K3  Agent Core & Local History                  (src-tauri/src/agent/{runtime,conversation,events,permission})
      ├─────────────────────────────────────────┐
      ▼                                         ▼
K4  19 Compiled CLI Adapters                    K5  Native Platform Effects
    (codex · claude · opencode · pi · acp)          (Win32 capture/snip/hotkeys/regions/Job Objects · macOS display)
```

Durable product, architecture, and UI contracts live in [`.agents/product.md`](.agents/product.md), [`.agents/engineering.md`](.agents/engineering.md), and [`.agents/DESIGN.md`](.agents/DESIGN.md).

---

## Development & Verification

### Prerequisites
- Windows 11 with **WebView2 Runtime** and **Visual Studio C++ Build Tools (MSVC)**
- **Bun** (`bun.lock`) and **Rust stable** (`src-tauri/Cargo.lock`)

### Run Locally
```powershell
bun install
bun run tauri dev
```

### Verification Commands
```powershell
# Dynamic affected checks & tests (default during iteration)
bun run test:affected:plan
bun run test:affected --with-checks

# Frontend lint, design/boundary ratchets, TypeScript & Vite bundle
bun run check
bun run build

# Full critical frontend + release contract + Codex fixture suite
bun run test:frontend:critical

# Rust formatting, locked check/tests, and strict Clippy
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml --locked
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
```

### Native Windows E2E Acceptance
A dependency-free WebDriver harness exercises real **`Otto.exe` → Tauri IPC → Rust Codex adapter → deterministic subprocess fixture** (no AI login or paid model calls required) to prove streaming continuity across collapse/reopen, non-focus-stealing background completion, and history restoration:

```powershell
# Requires Node.js 22+, tauri-driver 2.0.6, and matching msedgedriver.exe on PATH
# Close any running Otto instance before starting
bun install --frozen-lockfile
bun run tauri build --debug --no-bundle
bun run test:e2e:native
```

### CI & Release Pipeline
- [**Otto CI**](.github/workflows/otto-verify-once.yml) runs on pull requests and manual dispatch using `scripts/test-affected.mjs` to execute only affected Ubuntu frontend checks, filtered Windows Rust suites, and affected native Windows E2E journeys (`shell`, `transitions`, `p8`), with `suite=full` as the full safety net.
- [**Otto Release**](.github/workflows/release.yml) runs on `master` merges with frozen lockfiles, full frontend/Rust gates, native P8 E2E acceptance, NSIS bundling, minisign signing, SHA-256 checksums, curated [`CHANGELOG.md`](CHANGELOG.md) notes, immutable SemVer GitHub Releases, and signed `updates/latest.json` publication.
