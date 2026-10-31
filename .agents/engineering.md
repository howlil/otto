# Engineering — Otto

## System
One Tauri desktop process. React presentation -> Tauri commands/events -> Rust use cases -> Windows APIs or child CLI. No web backend.

## Structure
- K1 `src/`: presentation; feature state stays with feature. Add folders only when behavior exists.
- K2 `src-tauri/src/`: application startup, native window and later privileged feature implementations.
- K3 (future): CLI adapters below Rust agent domain; one adapter per Codex/Agy/Pi/OpenCode protocol.
- K4 (future): Windows integration for hotkey, capture, media, geometry.
UI must not spawn processes or access privileged OS APIs directly.

## Responsibilities
R1 (B1,B2,B7,X5): shell positioning, window privacy request, interaction modes.
R2 (B3,X1,X4): detect selected installed CLI, own process/session, normalize stream and cancel.
R3 (B4,X2): explicit screenshot trigger, capture, image handoff, temporary file cleanup.
R4 (B5,X3): OS media session, playback actions, lyrics availability.
R5 (B6): timer deadline, pause state and configurable durations.

## State
S1: active feature, placement, expanded mode | owner R1 | one active surface; persisted preferences later.
S2: provider/session/request lifecycle | owner R2 | terminal/cancelled run rejects late events.
S3: captured image/temp path | owner R3 | only explicit user action; delete on finish/cancel.
S4: media state | owner OS, read via R4 | derived UI representation.
S5: timer duration/deadline | owner R5 | remaining time is derived, not a mutable counter.

## Contracts
K1 -> K2: typed Tauri commands; incremental output via events. Errors are explicit recoverable results.
K2 -> K3: common request/events and provider capabilities (text,image,stream,resume,cancel); never assume parity.
K2 -> K4: OS result = available | unsupported | denied | error, no hidden fallbacks.
DEP1: WebView2 system runtime; absent runtime is an install/platform error.
DEP2: installed user CLI executables; unavailable provider returns actionable error, no credential duplication.

## Flows
Bootstrap (in scaffold): launch -> Tauri -> top-center frameless window -> React idle.
Agent (next): validate provider -> start owned CLI -> parse streaming events -> display -> finish/cancel -> cleanup.
Screenshot: explicit hotkey -> capture -> validate provider image capability -> send -> answer -> clean up.
Media: read OS session -> render -> send playback control -> observe update.
Timer: set duration -> deadline -> render derived remainder -> pause/resume/reset.
Placement: select mode -> measure monitor and window -> position -> morphing surface.

## Guarantees
G1 (C6,B4) [H]: no screenshot sent without explicit trigger; SLI: untriggered send count = 0, measured at capture/send entry points.
G2 (B3,X4) [H]: no owned child CLI after cancel/exit; SLI: owned process-tree survivors = 0 after cleanup, measured at process owner.
G3 (Q2) [M]: UI remains responsive during CLI work; measure input latency and frame timing on Windows.
G4 (X5,C4) [M]: do not claim privacy exclusion on unsupported recorders; inspect capture result on supported paths.
G5 (Q1) [M]: obtain idle/working measurements before performance targets.

## Challenge
| Flow | Threat / failure | Containment | Detection | Recovery |
| --- | --- | --- | --- | --- |
| Capture | automatic or leaked screenshot | explicit-action boundary; temporary file owner | capture/send invocation trace without image content | abort and delete |
| Agent | abandoned child or late events | process tree ownership and cancelled terminal state | process exit and run-state observations | terminate tree; restore idle controls |

## Decisions
DEC1 [one-way]: owner chose Tauri 2 + Rust + React/Vite/Tailwind for UI iteration speed; accept WebView2 overhead and measure it.
DEC2 [two-way]: one process with feature-owned state; avoid speculative services/store.
DEC3 [two-way]: structured provider protocols, not generic ANSI scraping.
DEC4 [two-way]: Windows 11 and best-effort contentProtected first; assess capture limitations on hardware.

## Fitness
F1: privileged operations belong to Rust commands; UI only consumes bounded Tauri capabilities.
F2: new feature dependencies use public feature entries; do not import sibling internals.

## Verification
- Frontend: `bun run build` (TypeScript + Vite, local/PR after install).
- Rust: `cd src-tauri && cargo check` on Windows MSVC; target runtime proof pending.
- Window placement/transparency/capture: one Windows release smoke; cannot prove through frontend compilation.

## Release
Windows installer only after build and representative machine smoke. No merge-to-release automation by default.

## Assumptions / Risks
A4 [non-blocking]: Bun dependency resolution must generate committed `bun.lock` before reproducible CI; no Windows build or CI status is claimed.
Risks: WebView2 idle cost, transparent resizing/hit region, provider protocol drift.
