# Otto

Windows desktop notch and AI CLI companion, built with **Tauri 2 + Rust + React + Vite + Tailwind CSS**.

## Development
Install Node.js 22+, Rust stable/MSVC, Windows C++ Build Tools, and the WebView2 runtime on Windows 11.

```powershell
npm install
npm run tauri dev
```

Frontend-only: `npm run dev`. Checks after dependency install: `npm run build` and `cd src-tauri; cargo check`.

## Current implementation
Only the static idle notch and native Tauri window setup are scaffolded. The window requests always-on-top and capture protection, but exclusion from all capture software cannot be guaranteed. AI chat, hotkey screenshot, streaming CLI adapters, morphing, music, Pomodoro, and two-finger navigation are **not implemented**.

Project contracts: `.agents/product.md`, `.agents/engineering.md`, `.agents/DESIGN.md`.
