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
Only the static idle notch and native Tauri window setup are scaffolded. The window requests always-on-top and capture protection, but exclusion from all capture software cannot be guaranteed. AI chat, hotkey screenshot, streaming CLI adapters, morphing, music, Pomodoro, and two-finger navigation are **not implemented**.

Project contracts: `.agents/product.md`, `.agents/engineering.md`, `.agents/DESIGN.md`.
