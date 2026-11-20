# Otto

Windows desktop notch and AI CLI companion, built with **Tauri 2 + Rust + React + Vite + Tailwind CSS**.

## Development
Install Bun, Rust stable (Windows MSVC toolchain), Windows C++ Build Tools, and WebView2 on Windows 11.

```powershell
bun install
bun run tauri dev
```

Frontend-only: `bun run dev`. After installing dependencies: `bun run check` (Biome), `bun run build` (TypeScript/Vite), then `cd src-tauri; cargo fmt --all -- --check; cargo clippy --all-targets -- -D warnings; cargo check` on Windows MSVC.

Keep the committed `bun.lock` and `src-tauri/Cargo.lock` in sync with real dependency resolution. CI and release builds use `bun install --frozen-lockfile` and Cargo `--locked`. During local development, run `bun run test:affected` (or `bun run test:affected:plan` to inspect the plan, with optional `--staged`, `--base <ref>`, `--with-checks`, or explicit paths) to execute only tests affected by your changes. Full suites remain available via `bun run test:frontend:critical` and `cargo test --locked --manifest-path src-tauri/Cargo.toml`. A successful build or unit suite does not establish native acceptance.

## Current implementation
Otto is a Windows-first **Personal AI Assistant & Learning Mentor** desktop notch built with Tauri 2, Rust, React 19, Vite 8, TypeScript 6, and Tailwind CSS 4. Hover previews the composer without taking focus; click or keyboard activation pins it for interaction. In Otto OS coexistence mode, Otto docks cleanly as a compact circle with state-change motion cues.

Otto supports 19 locally installed AI CLI engines (Codex, Pi, OpenCode, Claude Code, and 15 ACP CLIs) with live Windows `Refresh PATH` discovery, six curated Learning Modes (`Direct`, `Solve`, `Mentor`, `Simple`, `Write & Translate`, `Practice`), static Profile & Learning Style preferences, staged-first Smart Capture 2.0 (Region Snip with live scroll stitching, window/scrolling/full-screen/selected-text capture, `Ctrl+V`/drop image staging, dual independent hotkeys), 100-message local conversation history with full-text search and Markdown export, Retry/Edit/single-slot follow-up queuing, universal external-caret Insert, and inline host permission choices (`Decline & continue` / `Allow once`, never auto-approved). Otto owns no edit/shell executor and preserves each CLI's native authentication, tools, and permissions.

UI design baseline (Agent and settings): `.agents/DESIGN.md` together with the current React/Tauri implementation and tokens in `src/style.css`. Do not create standalone HTML design prototypes.

Project contracts: `.agents/product.md`, `.agents/engineering.md`, `.agents/DESIGN.md`, and `CHANGELOG.md`.

## CI and native E2E

[Otto CI](https://github.com/howlil/otto/actions/workflows/otto-verify-once.yml) runs on pull-request events and by manual dispatch. A change-detection job (`scripts/test-affected.mjs`) dynamically traces changed files to run only affected Ubuntu frontend checks/tests, filtered Windows Rust tests/lints, and per-suite Windows native E2E journeys (`shell`, `transitions`, `p8`). Unrelated jobs and native E2E suites are skipped; manual `suite=full` and `release.yml` run the full suite as the safety net. PR updates cancel superseded runs; there is no duplicate branch-push verification trigger.

The native gate runs only after affected frontend and Rust gates succeed, builds debug Otto.exe, installs WebDriver only when `transitions` or `p8` is affected, and runs only the selected native suite(s) without AI authentication or paid model calls. The separate [release workflow](https://github.com/howlil/otto/actions/workflows/release.yml) runs full verification, native P8 E2E, signs updater artifacts, and publishes stable SemVer releases from `master` with curated `CHANGELOG.md` notes.

CI evidence must match the exact delivered SHA; an older green run does not validate newer commits or dirty changes. Existing P8 fixture proof does not establish signed-in provider behavior, native capture targeting, process-tree cleanup or restart acceptance.

## Native E2E — P8 background continuity

A dependency-free WebDriver harness exercises **Otto.exe → Tauri IPC → Rust Codex adapter → subprocess fixture**, including streaming, collapsing and reopening the Agent composer, and completion in the background. No AI login or network model call is used.

**GitHub Actions supports unattended fixture acceptance.** Pull-request updates trigger verification automatically; to explicitly request desktop verification, open **Otto CI**, choose **Run workflow**, select the branch and `suite=full`. Frontend checks run on Ubuntu, while separate Windows jobs run Rustfmt/tests/Clippy and the native journeys described above. No local Windows setup, AI credentials, release packaging or hosted model calls are required for that CI run.

For optional local debugging on Windows 11, install Node.js 22+, `tauri-driver` (`cargo install tauri-driver --version 2.0.6 --locked`), and `msedgedriver.exe` matching the Edge WebView2 runtime. Put both drivers on PATH. Use an isolated Windows test account and close any existing Otto instance before the run.

```powershell
bun install --frozen-lockfile
bun run tauri build --debug --no-bundle
bun run test:e2e:native
```

`OTTO_E2E_APP` may point to an alternative compiled Otto executable; `OTTO_E2E_PORT` defaults to 4540. The fixture injects `codex.cmd` only into the spawned test driver PATH; it does not modify CLI authentication or production settings. Run `bun run test:frontend:critical` for the fast fixture protocol contract (no Windows desktop needed).

Local native evidence must identify the tested executable/source state; PR integration requires passing checks on the exact delivered SHA. Keep the desktop idle during mouse/focus acceptance; unexpected input invalidates the probe. Do not treat a passing fixture unit test as desktop E2E proof.
