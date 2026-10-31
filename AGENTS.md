# Otto — agent instructions

## Stack
Windows-first Tauri 2, Rust edition 2024, React 19, Vite 8, TypeScript 6, Tailwind CSS 4.

## Commands
Install: `bun install`; dev frontend: `bun run dev`; desktop: `bun run tauri dev`.
Frontend: `bun run check` (Biome), `bun run format` (fix), `bun run build` (TS/Vite).
Rust: `cd src-tauri && cargo fmt --all -- --check`; `cargo clippy --all-targets -- -D warnings`; `cargo check` on Windows MSVC.
Tests: TBD — no feature suite for static bootstrap. Generate/commit Bun and Cargo locks when dependency resolution becomes available for a reproducible build; do not fabricate locks.

## Verification gate
Use the cheapest proof for changed behavior; don't call Windows native functionality verified without Windows run. Stage map: `.agents/engineering.md` ## Verification.

## Conventions / boundaries
TypeScript/React: `PascalCase` components/types, `useX` Hooks, `camelCase` functions, kebab-case feature directories. Rust: snake_case modules/functions, PascalCase types, Rustfmt/Clippy. Prefer explicit errors and single state owners; SOLID describes responsibilities, not mandatory classes/interfaces. Add patterns only for a proven need; keep changes scoped.
`src/` owns UI-local state; no shell/subprocess/privileged calls outside Rust. `src-tauri/` owns OS, CLI processes and screenshot lifecycle. Only add feature directories when implementing them. Source UI tokens from `src/style.css` and use `.agents/DESIGN.md` for UI behavior; do not scatter literal semantic colors. Before designing or changing a module, read its approved `design/<module>.html` reference if it exists (Agent: `design/agent.html`; Focus/Pomodoro: `design/pomodoro.html`) and preserve its established layout, states, interactions and motion unless the owner changes them; use `design/otto-v9-baseline.html` for shared shell geometry. These HTML files are interactive design references, not production implementations. Structural rules and decisions live in `.agents/engineering.md`.

## Target codebase
The concrete target tree, module public entries, dependency direction and K1–K5 boundaries live in `.agents/engineering.md` `## Structure`. Do not pre-create planned directories or duplicate that specification here.

## Development workflow
- ChatGPT Web + GitHub is the active development environment. Recover the open PR for this outcome, its HEAD, files and available checks first; "Next" continues the same PR. Do not require local machine setup to document or implement reviewable changes; never claim builds or runtime verification that did not happen.
- One coherent vertical slice per feature PR; use `feat/`, `fix/`, or `chore/` only when a branch is needed. Fix failures on the same branch; no Issue/branch/PR per file, skill, retry, trivial edit, or speculative milestone.
- PR body stays current: `Behavior`, `Verification` (`green @SHA`, `red @SHA`, or `not run`), material `Risks` if any, and one `Next` action. Replace stale evidence, never append progress logs.
- Use the cheapest faithful checks for changed risks, review the actual diff and engineering contracts, and do not merge with failing/missing required proof or Major/Critical findings. Merge only after explicit owner authorization; prefer squash and delete merged branches. Repository settings are not yet an enforced gate.
- Persist durable product/engineering/UI decisions only in their owning `.agents/` files, active evidence in the PR, independent deferred work in an Issue only when useful, and shipped facts in immutable tags/releases. Avoid separate plans, status ledgers, or process documents.
- Merge is not release. Versioning, release evidence, installer publication and recovery are specified in `.agents/engineering.md` `## Release`; never publish or tag without owner authorization.

## Safety
No secrets, screenshots or user CLI credentials in repo/logs. Screenshots only after explicit user trigger. Capture exclusion is best effort. Ask before force-push, publish, release, deploy or destructive changes.

## Project memory
Product: `.agents/product.md`. System: `.agents/engineering.md`. UI: `.agents/DESIGN.md`.
