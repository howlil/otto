# Otto — agent instructions

## Stack
Windows-first Tauri 2, Rust edition 2024, React 19, Vite 8, TypeScript 6, Tailwind CSS 4.

## Commands
Install: `bun install`; dev frontend: `bun run dev`; desktop: `bun run tauri dev`.
Frontend: `bun run check` (Biome), `bun run format` (fix), `bun run build` (TS/Vite).
Rust: `cd src-tauri && cargo fmt --all -- --check`; `cargo clippy --all-targets -- -D warnings`; `cargo check` on Windows MSVC.
Tests: `cargo test --manifest-path src-tauri/Cargo.toml` (Rust core) and `bun run test:frontend:critical` (Agent draft behavior); both run in the existing Windows verification workflow. Committed Bun and Cargo lockfiles are required for frozen CI and release builds.

## Verification gate
For every change, apply Agentflow `test-engineering` triage to the **changed behavior/invariant**, not every touched file: does it affect a P#/G#/failure path, state transition, user interaction, or external boundary; would an existing test detect the regression; and what is the cheapest **faithful** proof? No material new risk or already-proven behavior -> reuse existing checks, no ceremonial test.
Classify risk using impact (security/privacy, unauthorized action, data loss, interrupted work, user-visible correctness) and likelihood (novelty, concurrency, complexity, recent defects). Independently classify proof cost (write + runtime + maintenance): **high-impact/low-cost first**; **high-impact/high-cost required** when no cheaper proof can establish a critical invariant; low-impact/low-cost only if worthwhile; low-impact/high-cost skip. Cost never excuses an unproven critical guarantee.
For new or changed **critical Rust core and frontend behavior** use **TDD first**: name the invariant and concrete regression, observe a failing behavior test (Red), implement minimum correct behavior (Green), then refactor with that proof green. A Red caused by test setup, import or compilation failure does not count. If faithful Red cannot be observed, state why and provide equivalent behavior proof; do not claim TDD without observed Red.
Cover meaningful **happy path, failure path and boundary/edge cases** for the invariant; test count is not a quota and unrelated invented edge cases are forbidden. Assert observable decisions, state transitions, rendered user interaction, persisted state or actual side effects—not mock calls, getters, constants, implementation snapshots or coverage percentages. Deliberately break critical logic when practical to confirm its proof fails.
Frontend is **not exempt**: pure state/async rules use Bun unit tests; critical React input, navigation, approval, draft ownership and recovery wiring use a component interaction test when pure tests cannot prove the user journey. Server-rendered markup alone does not prove click/focus/effect behavior. Rust policy and process semantics use Rust tests; Tauri IPC, filesystem, subprocess and Win32 behavior require integration/native proof when mocks omit the invariant.
Run only affected fast tests at `iter`, risk-matched checks at `pr`, and expensive native/E2E at `release`. Reuse existing commands and harnesses; introduce a test dependency only for a proven gap; never create tests, workflows or files to inflate counts. Do not report Windows native behavior verified without Windows runtime evidence. Flaky is a defect, not a reason to rerun until green.
Before declaring done, report the changed invariant, impact/cost decision, reused/new proof and its happy/failure/edge coverage, observed Red/Green or exception, executed commands, and remaining unverified risk. Missing faithful critical proof blocks review/merge. Stage map and PF ownership: `.agents/engineering.md` `## Verification`.

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
