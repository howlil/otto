# Otto — agent instructions

## Stack
Windows-first Tauri 2, Rust edition 2024, React 19, Vite 8, TypeScript 6, Tailwind CSS 4.

## Commands
Install: `bun install`; dev frontend: `bun run dev`; desktop: `bun run tauri dev`.
Frontend: `bun run check` (Biome), `bun run format` (fix), `bun run build` (TS/Vite).
Rust: `cd src-tauri && cargo fmt --all -- --check`; `cargo clippy --all-targets -- -D warnings`; `cargo check` on Windows MSVC.
Tests: `cargo test --manifest-path src-tauri/Cargo.toml` (Rust core) and `bun run test:frontend:critical` (Agent draft behavior); CI selects the affected gate, while `suite=full` runs both. Committed Bun and Cargo lockfiles are required for frozen CI and release builds.

## Verification gate
Use the affected behavior/invariant and the cheapest faithful proof defined in `.agents/engineering.md` `## Verification`. Run only the stage-appropriate checks from `Commands`, and report native or runtime evidence gaps explicitly.

## Conventions / boundaries
TypeScript/React: `PascalCase` components/types, `useX` Hooks, `camelCase` functions, kebab-case feature directories. Rust: snake_case modules/functions, PascalCase types, Rustfmt/Clippy. Prefer explicit errors and single state owners; SOLID describes responsibilities, not mandatory classes/interfaces. Add patterns only for a proven need; keep changes scoped.
No comments in code: agents must not write comments in code (no inline comments, block comments, explanatory notes, or commented-out code); keep code clean, self-explanatory, and self-documenting.
`src/` owns UI-local state; no shell/subprocess/privileged calls outside Rust. `src-tauri/` owns OS, CLI processes and screenshot lifecycle. Only add feature directories when implementing them. Source UI tokens from `src/style.css` and use `.agents/DESIGN.md` for UI behavior; do not scatter literal semantic colors. For **every** UI/design task (implement, refactor, review, style, motion, layout or new feature), **read `.agents/DESIGN.md` before making changes** and inspect the current React/Tauri surface, state ownership and shared tokens. `.agents/DESIGN.md` is the durable design contract and the current source is the implementation reference. Do not create or maintain standalone HTML design prototypes. Keep the contract aligned when an approved design behavior changes; structural rules and decisions live in `.agents/engineering.md`.

## Target codebase
The concrete target tree, module public entries, dependency direction and K1–K5 boundaries live in `.agents/engineering.md` `## Structure`. Do not pre-create planned directories or duplicate that specification here.

## Workflow
Follow Agentflow for routing, slicing, review, and delivery. Otto-specific verification and release rules live in `.agents/engineering.md`.

## Safety
No secrets, screenshots or user CLI credentials in repo/logs. Screenshots only after explicit user trigger. Capture exclusion is best effort. Automatic prerelease publication after a successful merge is authorized. Ask before force-push, ad hoc manual publication, stable release, deploy outside the configured pipeline or destructive changes.

## Project memory
Product: `.agents/product.md`. System: `.agents/engineering.md`. UI: `.agents/DESIGN.md`.
