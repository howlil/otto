# Otto

Windows desktop notch and AI CLI companion, built with **Tauri 2 + Rust + React + Vite + Tailwind CSS**.

## Development
Install Bun, Rust stable (Windows MSVC toolchain), Windows C++ Build Tools, and WebView2 on Windows 11.

```powershell
bun install
bun run tauri dev
```

Frontend-only: `bun run dev`. After installing dependencies: `bun run check` (Biome), `bun run build` (TypeScript/Vite), then `cd src-tauri; cargo fmt --all -- --check; cargo clippy --all-targets -- -D warnings; cargo check` on Windows MSVC.

Current development is coordinated through ChatGPT Web + GitHub; no CI workflow or mandatory local setup gate is configured. Native builds are unverified until actually executed. When preparing a reproducible build or release, generate and commit `bun.lock` with Bun and `src-tauri/Cargo.lock` with Cargo from real dependency resolution (never synthesize lockfile contents).

## Current implementation
The current feature branch contains a **candidate, not Windows-verified** Codex Quick Ask vertical slice: Compact/Expanded shell, typed IPC, Codex app-server via stdio, read-only/fail-closed policy, in-memory streaming/follow-up, Stop, and bounded native window resizing. Requires a locally installed, authenticated Codex CLI on PATH and an explicit working directory. Native focus behavior, sandbox effectiveness, CLI process-tree cleanup, and compilation still require Windows proof. Other providers, screenshot, music, Pomodoro, attached-notch shoulder geometry, and gesture navigation are **not implemented**.

UI design baseline (all modules and settings): [`design/otto.html`](design/otto.html). This is the **only** design HTML; use it alongside `.agents/DESIGN.md` for UI implementation and reviews. Do not create per-module HTML prototypes.

Project contracts: `.agents/product.md`, `.agents/engineering.md`, `.agents/DESIGN.md`.

## CI and native E2E

[Otto CI](https://github.com/howlil/otto/actions/workflows/otto-verify-once.yml) runs on PRs targeting master and by manual dispatch. Two sequential jobs run: Ubuntu frontend/build/contract checks, then Windows Rust checks. Only one CI workflow exists; PR updates cancel superseded runs, and no branch-push trigger duplicates them.

For desktop acceptance, select Actions > Otto CI > Run workflow, select the branch and suite=full. This builds a debug Otto.exe and runs P8 streaming/Home/reopen/background completion through a deterministic Codex CLI fixture, without AI authentication or paid API calls. Select suite=fast to skip native E2E. The separate release workflow keeps its versioned publishing behavior.

Windows E2E is unverified until a matching GitHub Actions run passes. Existing P8 proof does not claim coverage of P3 Stop, P9 approvals, P11 readiness, native capture or P12 restart.
