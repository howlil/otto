# Otto

Windows desktop notch and AI CLI companion, built with **Tauri 2 + Rust + React + Vite + Tailwind CSS**.

## Development
Install Bun, Rust stable (Windows MSVC toolchain), Windows C++ Build Tools, and WebView2 on Windows 11.

```powershell
bun install
bun run tauri dev
```

Frontend-only: `bun run dev`. After installing dependencies: `bun run check` (Biome), `bun run build` (TypeScript/Vite), then `cd src-tauri; cargo fmt --all -- --check; cargo clippy --all-targets -- -D warnings; cargo check` on Windows MSVC.

Keep the committed `bun.lock` and `src-tauri/Cargo.lock` in sync with real dependency resolution. CI and release builds use `bun install --frozen-lockfile` and Cargo `--locked`. Run `bun run test:frontend:critical` for frontend behavior and CLI contract tests, and `cargo test --locked --manifest-path src-tauri/Cargo.toml` for Rust tests. A successful build or unit suite does not establish native acceptance.

## Current implementation
Otto implements a Compact/Preview/Pinned shell over a stable native host, typed IPC, Codex/Pi/Agy adapters, streaming/follow-up, Stop, local conversation history and explicit capture. Assistant operation requires a compatible locally installed, authenticated CLI on PATH; Coding Mode remains a design target. Native focus, provider policy, capture targeting, CLI process-tree cleanup, restart and installer/updater behavior require their own Windows acceptance; fixture or build results do not establish those guarantees. Supporting-feature contracts and remaining risks are maintained in `.agents/`. Music offers Player and LRCLIB Lyrics only; captions and speech recognition are out of scope.

UI design baseline (all modules and settings): [`design/otto.html`](design/otto.html). This is the **only** design HTML; use it alongside `.agents/DESIGN.md` for UI implementation and reviews. Do not create per-module HTML prototypes.

Project contracts: `.agents/product.md`, `.agents/engineering.md`, `.agents/DESIGN.md`.

## CI and native E2E

[Otto CI](https://github.com/howlil/otto/actions/workflows/otto-verify-once.yml) runs on pull-request events and by manual dispatch. Ubuntu frontend/build/contract checks and Windows Rust checks run independently. A change-detection job selects a separate Windows native gate for native-relevant paths; manual `suite=full` also requests that gate. `suite=fast` does not force native E2E, but a native-relevant diff can still select it. PR updates cancel superseded runs; there is no duplicate branch-push verification trigger.

The native gate follows change detection and Windows Rust checks. It builds debug Otto.exe, matches Edge WebDriver to WebView2, and runs Win32 silhouette/capture, shell transitions and the deterministic P8 background-continuity journey without AI authentication or paid model calls. The separate [release workflow](https://github.com/howlil/otto/actions/workflows/release.yml) verifies and publishes prereleases after merges to `master`.

CI evidence must match the exact delivered SHA; an older green run does not validate newer commits or dirty changes. Existing P8 fixture proof does not establish signed-in provider behavior, native capture targeting, process-tree cleanup or restart acceptance.

## Native E2E — P8 background continuity

A dependency-free WebDriver harness exercises **Otto.exe → Tauri IPC → Rust Codex adapter → subprocess fixture**, including streaming, navigating Home, reopening the same run, and completion in the background. No AI login or network model call is used.

**GitHub Actions supports unattended fixture acceptance.** Pull-request updates trigger verification automatically; to explicitly request desktop verification, open **Otto CI**, choose **Run workflow**, select the branch and `suite=full`. Frontend checks run on Ubuntu, while separate Windows jobs run Rustfmt/tests/Clippy and the native journeys described above. No local Windows setup, AI credentials, release packaging or hosted model calls are required for that CI run.

For optional local debugging on Windows 11, install Node.js 22+, `tauri-driver` (`cargo install tauri-driver --version 2.0.6 --locked`), and `msedgedriver.exe` matching the Edge WebView2 runtime. Put both drivers on PATH. Use an isolated Windows test account and close any existing Otto instance before the run.

```powershell
bun install --frozen-lockfile
bun run tauri build --debug --no-bundle
bun run test:e2e:native
```

`OTTO_E2E_APP` may point to an alternative compiled Otto executable; `OTTO_E2E_PORT` defaults to 4540. The fixture injects `codex.cmd` only into the spawned test driver PATH; it does not modify CLI authentication or production settings. Run `bun run test:frontend:critical` for the fast fixture protocol contract (no Windows desktop needed).

Local native evidence must identify the tested executable/source state; PR integration requires passing checks on the exact delivered SHA. Keep the desktop idle during mouse/focus acceptance; unexpected input invalidates the probe. Do not treat a passing fixture unit test as desktop E2E proof.
