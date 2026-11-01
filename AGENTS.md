# Otto — agent instructions

## Stack
Windows-first Tauri 2, Rust edition 2024, React 19, Vite 8, TypeScript 6, Tailwind CSS 4.

## Commands
Install: `bun install`; dev frontend: `bun run dev`; desktop: `bun run tauri dev`.
Frontend: `bun run check` (Biome), `bun run format` (fix), `bun run build` (TS/Vite).
Rust: `cd src-tauri && cargo fmt --all -- --check`; `cargo clippy --all-targets -- -D warnings`; `cargo check` on Windows MSVC.
Tests: `cargo test --manifest-path src-tauri/Cargo.toml` (Rust core) and `bun run test:frontend:critical` (Agent draft behavior); both run in the existing Windows verification workflow. Committed Bun and Cargo lockfiles are required for frozen CI and release builds.

## Verification gate
Critical-path or core-logic changes **must** have an automated behavior test at the cheapest faithful boundary (unit for pure rules/state; integration when correctness depends on OS, process, persistence or IPC). Reuse existing proof if it already catches the regression; missing proof blocks review/merge. Cosmetic, trivial wiring and docs changes do not require ceremonial new tests.
For critical logic, use **TDD by default**: identify the invariant and a concrete failure, write a regression test that fails for the defect (Red), implement the minimum fix (Green), then refactor with tests passing. If Red cannot be demonstrated safely or faithfully, state why and provide equivalent behavioral proof; do not claim TDD without observed Red.
Tests must assert observable decisions, state transitions or external effects, including meaningful failure/edge cases; reject tests of mocks themselves, trivial getters, static constants or coverage-for-coverage's-sake. Show that critical proof would catch the intended defect; a green test count alone is insufficient. Reviewers must block missing or ceremonial critical-path proof.
Use existing test commands and proportionate stages; do not add test frameworks/workflows without a concrete untestable risk. Don't call Windows native functionality verified without Windows runtime proof. Stage map: `.agents/engineering.md` ## Verification.

## Conventions / boundaries
TypeScript/React: `PascalCase` components/types, `useX` Hooks, `camelCase` functions, kebab-case feature directories. Rust: snake_case modules/functions, PascalCase types, Rustfmt/Clippy. Prefer explicit errors and single state owners; SOLID describes responsibilities, not mandatory classes/interfaces. Add patterns only for a proven need; keep changes scoped.
No comments in code: agents must not write comments in code (no inline comments, block comments, explanatory notes, or commented-out code); keep code clean, self-explanatory, and self-documenting.
`src/` owns UI-local state; no shell/subprocess/privileged calls outside Rust. `src-tauri/` owns OS, CLI processes and screenshot lifecycle. Only add feature directories when implementing them. Source UI tokens from `src/style.css` and use `.agents/DESIGN.md` for UI behavior; do not scatter literal semantic colors. For **every** UI/design task (implement, refactor, review, style, motion, layout or new feature), **read `design/otto.html` before making changes** and consult `.agents/DESIGN.md` for its constraints. `design/otto.html` is the **only canonical interactive design** for Home/Idle, Agent, Music/Lyrics, Pomodoro, OS Events, Global Settings, Agent Settings, Compact/Expanded, Floating/Attached and navigation. **Do not create, restore, fork, or use separate `design/*.html` module or version prototypes**; make design changes directly in `design/otto.html`, keeping all approved surfaces, controls, states, sizes, geometry and interactions unless the owner explicitly requests their removal. Changes to native React/Tauri UI must be checked against this reference; when a design change is approved, keep the canonical HTML aligned. HTML previews are visual/interaction references, not evidence of native functionality. Structural rules and decisions live in `.agents/engineering.md`.

## Target codebase
The concrete target tree, module public entries, dependency direction and K1–K5 boundaries live in `.agents/engineering.md` `## Structure`. Do not pre-create planned directories or duplicate that specification here.

## Development workflow
- ChatGPT Web + GitHub is the active development environment. Recover the open PR for this outcome, its HEAD, files and available checks first; "Next" continues the same PR. Do not require local machine setup to document or implement reviewable changes; never claim builds or runtime verification that did not happen.
- One coherent vertical slice per feature PR; use `feat/`, `fix/`, or `chore/` only when a branch is needed. Fix failures on the same branch; no Issue/branch/PR per file, skill, retry, trivial edit, or speculative milestone.
- PR body stays current: `Behavior`, `Verification` (`green @SHA`, `red @SHA`, or `not run`), material `Risks` if any, and one `Next` action. Replace stale evidence, never append progress logs.
- Use the cheapest faithful checks for changed risks, review the actual diff and engineering contracts, and do not merge with failing/missing required proof or Major/Critical findings. Merge only after explicit owner authorization; prefer squash and delete merged branches. Repository settings are not yet an enforced gate.
- Persist durable product/engineering/UI decisions only in their owning `.agents/` files, active evidence in the PR, independent deferred work in an Issue only when useful, and shipped facts in immutable tags/releases. Avoid separate plans, status ledgers, or process documents.
- Windows CI is manual-only (`workflow_dispatch`): select the current PR branch in Actions and run it before merge; a green run must match the exact HEAD. PR updates must not start CI automatically. Merges to `master` still trigger the authorized automatic Windows prerelease pipeline. Version selection, proof, GitHub Release publication and recovery are specified in `.agents/engineering.md` `## Release`. No separate release PR or manual release dispatch.

## Safety
No secrets, screenshots or user CLI credentials in repo/logs. Screenshots only after explicit user trigger. Capture exclusion is best effort. Automatic prerelease publication after a successful merge is authorized. Ask before force-push, ad hoc manual publication, stable release, deploy outside the configured pipeline or destructive changes.

## Project memory
Product: `.agents/product.md`. System: `.agents/engineering.md`. UI: `.agents/DESIGN.md`.
