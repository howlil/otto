# Otto — agent instructions

## Stack
Windows-first Tauri 2, Rust edition 2024, React 19, Vite 8, TypeScript 6, Tailwind CSS 4.

## Commands
Install: `bun install`; dev frontend: `bun run dev`; desktop: `bun run tauri dev`.
Frontend build: `bun run build`; Rust check: `cd src-tauri && cargo check`.
Tests: TBD — no new suite for static bootstrap. Commit `bun.lock` once generated; use `bun install --frozen-lockfile` in CI.

## Verification gate
Use the cheapest proof for changed behavior; don't call Windows native functionality verified without Windows run. Stage map: `.agents/engineering.md` ## Verification.

## Conventions / boundaries
`src/` owns UI-local state; no shell/subprocess/privileged calls outside Rust. `src-tauri/` owns OS, CLI processes and screenshot lifecycle. Only add feature directories when implementing them. Reuse CSS tokens instead of scattered colors.

## Safety
No secrets, screenshots or user CLI credentials in repo/logs. Screenshots only after explicit user trigger. Capture exclusion is best effort. Ask before force-push, publish, release, deploy or destructive changes.

## Project memory
Product: `.agents/product.md`. System: `.agents/engineering.md`. UI: `.agents/DESIGN.md`.
