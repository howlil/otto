# Engineering — Otto

## System
Windows-first Tauri 2 modular monolith, not a cloud service:
React presentation (K1) -> narrow Tauri controller (K2) -> Rust agent/use-case owner (K3) <- provider adapters (K4); native Windows host (K5) handles window/capture/media integrations. Bun builds the frontend. WebView2 is part of the desktop runtime.
Current feature branch implements the Codex Quick Ask code path and the Agent Session approval slice (mode policy, Rust-owned pending approval, real command/file-change approval, Allow once / Deny), **not Windows-verified**. Screenshot, music, timer, attached placement and gestures remain contracts, not implemented behavior.

## Structure
Target layout below is a **design**, not a claim that directories exist. Present now: `src/{main.tsx,App.tsx,style.css}`, `src-tauri/src/{main.rs,lib.rs}`, Tauri configuration/capabilities, and root project files. Create future files only with the behavior that uses them.

```text
otto/
├── src/                               # K1: React presentation
│   ├── main.tsx, App.tsx, style.css   # existing entry, shell, tokens
│   ├── features/                      # add per implemented behavior
│   │   ├── shell/                     # B1/B2/B7/B10: notch UI + focus intent
│   │   ├── agent/                     # B3/B8/B9/B11: chat, draft, status UI
│   │   ├── music/                     # B5: music UI, later
│   │   └── timer/                     # B6: Pomodoro UI, later
│   ├── platform/tauri.ts              # typed Tauri transport, later
│   └── shared/ui/                     # reused stateless primitives only
├── src-tauri/
│   ├── src/
│   │   ├── main.rs, lib.rs            # existing startup/composition root
│   │   ├── commands.rs                # K2: Tauri IPC validation/dispatch
│   │   ├── agent/                     # K3: Rust run/policy owner
│   │   │   ├── mod.rs                 # agent public entry + domain contract
│   │   │   ├── session.rs             # run lifecycle/ordered stream/cleanup
│   │   │   ├── policy.rs              # Quick Ask/approval enforcement
│   │   │   └── providers/             # K4: CLI protocol adapters
│   │   │       ├── mod.rs             # provider port implementations
│   │   │       ├── codex.rs           # first actual provider
│   │   │       ├── agy.rs             # later
│   │   │       ├── pi.rs              # later
│   │   │       └── opencode.rs        # later
│   │   ├── windows/                   # K5: native Windows integration
│   │   │   ├── mod.rs                 # OS integration public entry
│   │   │   ├── window.rs              # position/focus/capture protection
│   │   │   ├── capture.rs             # explicit hotkey/target/image lifetime
│   │   │   └── media.rs               # OS media session, later
│   │   └── timer.rs                   # R5: timer owner, later
│   ├── capabilities/default.json      # existing privilege allowlist
│   └── tauri.conf.json                # existing app/window configuration
├── .agents/                           # product.md, engineering.md, DESIGN.md
└── AGENTS.md                          # short agent operating instructions
```

- **K1 (presentation):** each feature owns its view and UI-local state; render-only UI takes props/events, not direct IPC calls. Feature adapters call `src/platform/tauri.ts` when a shared typed transport is needed. `shared/ui` appears only after real reuse.
- **K2 (controller):** `lib.rs` wires commands/state; `commands.rs` parses/validates and delegates to K3/K5/R5, without business or CLI protocol rules.
- **K3 (logic):** `agent/mod.rs` is the only Rust agent-domain entry; session and policy own S3/S4, define provider-facing capabilities, and depend on no Tauri, React, or concrete CLI adapter types.
- **K4 (data/external):** `agent/providers/mod.rs` provides implementations of K3-owned provider contracts; `codex.rs` first, remaining files only when supported. No provider imports presentation or owns authoritative session state.
- **K5 (native):** `windows/mod.rs` exposes bounded OS capabilities; private window/capture/media code cannot authorize an AI action. `timer.rs` is feature-specific, not a generic service.
- **Dependency direction:** React feature -> typed IPC client -> K2 controller -> K3 logic <- K4 provider adapter; K2 -> K5 native capabilities. Cross-feature calls use a public `index.ts`/`mod.rs` only once an actual second consumer exists; no import of sibling internals or generic `utils`/service folders.
- **Conventions/patterns:** PascalCase React components/types, camelCase TS values, `useX` Hooks, kebab-case feature folders; Rust snake_case modules/functions, PascalCase types. Prefer one state owner, composition, and an Adapter only where CLI protocols actually differ; avoid speculative Factories/Repositories/DI.

## Responsibilities
- R1 (B1,B2,B10): present idle/compact/expanded state, navigation, active feature, drafts, unobtrusive completion and keyboard/focus intent.
- R2 (B3,B8,X1,X4,X10): own CLI run/session lifetime, stream ordering, follow-up, stop, collapse continuity and restart reconciliation.
- R3 (B4,X2,X6,X8): explicitly triggered capture, external-window target validation, hotkey conflicts, supported image submission and temporary-file cleanup.
- R4 (B5,X3): observe system media/lyrics availability, show accurate playback state and handle supported controls.
- R5 (B6): configurable focus/break timer, monotonic deadline, pause/resume/reset.
- R6 (B1,B2,B7,B10,X5): own native window position, pointer region, always-on-top, focus and best-effort capture exclusion.
- R7 (B3,B9,B11,X1,X7,X9): validate provider readiness/auth/capability, working context, Quick Ask restrictions and explicit tool approvals; fail closed when unsupported.

## State
- S1: active feature, exclusive Compact/Preview/Pinned shell mode and feature-local unsent agent draft | owner R1 (React) | background events cannot change selection/focus; one UI writer; draft is sensitive local memory, discarded on exit (RPO: unsent edits may be lost).
- S2: placement, native bounds and focus policy | owner R6 (Rust) | no implicit activation on hover; single window host writer; internal metadata, restore preference only if explicitly persisted later.
- S3: agent run/session/status/output | owner R2 (Rust) | run_id with ordered sequence and exactly one terminal outcome; terminal run rejects late events; one authority even if UI collapses; sensitive user/model text stays memory-only. For X10, app-local storage keeps only an in-flight numeric run marker; startup treats a leftover marker as possibly interrupted, never as resumed/completed, and does not persist transcript/image/auth. RPO: active run is not durable; recover only provider-verifiable sessions (A5).
- S4: provider identity, capability, working directory and approval state | owner R7 (Rust) | readiness verified before launch; no approval assumed or invented; never persist authentication secrets; sensitive context metadata remains memory-only by default.
- S5: target window, capture request and image lifetime | owner R3 (Rust) | explicit invocation provenance, still-valid non-Otto target, no send on ambiguity/denial; sensitive images are ephemeral with Drop cleanup on finish/error/cancel. After a crash, startup may delete only named capture files aged >=24h when the owning PID is confirmed exited; unknown/active PIDs and unrelated files are preserved. Best effort, not secure erasure.
- S6: media observation | owner R4 (Rust cache; OS is source of truth) | no fabricated lyrics/sessions; ephemeral, no permanent media history.
- S7: focus/break duration, timer deadline and paused state | owner R5 | deadline is authority and remaining time derived; settings retention only if preference storage is explicitly introduced.
- Concurrent writes: one active run owner serializes run transitions; independent background completions update their own data, never S1. UI events are observations, not independent authoritative copies.

## Contracts
- K1 -> K2: typed Tauri command `submit/stop/provider_status` (names illustrative until implemented), input validation and bounded payload; immediate outcome = accepted run_id or recoverable error. Rendering the UI cannot authorize OS side effects.
- K2 -> K3: Quick Ask vs Agent Session is a policy decision at the Rust boundary, not a UI label. Quick Ask can launch only with provider-enforced no-file-write capabilities; otherwise report unsupported. Tool execution/approval cannot bypass provider and user policy.
- K3 <-> K4: validate CLI executable/version/auth and capability (text, image, streaming, resume, cancellation, approval) before use. One-shot and long-running provider protocols may differ; adapters normalize `run_id, seq, event, terminal`. No universal ANSI scraping or silently changed provider/session.
- K3 -> K1: ordered Tauri channel for run output and terminal outcome; separate low-frequency notifications may use events. Sequence/run_id guards ignore late, duplicate or stale output; Stop is idempotent for that run. UI collapse neither stops nor detaches the run owner.
- K3 -> process boundary: executable plus argument array only (no shell interpolation), verified project working directory, owned process group/tree, cleanup on stop/normal exit/app exit. CLI output is untrusted data; never render executable HTML or leak secrets in logs.
- K2/K3 -> K5: OS capabilities return `available | unsupported | denied | failed`. Capture target is pinned from the last external foreground window, revalidated before use; a hotkey conflict requires reconfiguration; no silent target substitution.
- Compatibility: in-process IPC changes update both caller and callee together; provider protocol differences are adapter-local and unsupported versions fail closed. Any future durable schema follows compatible expand/migrate/contract steps.
- DEP1: Windows WebView2 | reuse OS runtime | missing runtime prevents UI, show installer/runtime remediation | availability bound: OS installation | exit cost: switching Tauri UI stack.
- DEP2: Codex/Agy/Pi/OpenCode executables | reuse user install/auth | absent, version drift, auth expiry, denied approval = explicit recoverable state | availability bound: local CLI/provider service | exit cost: per-provider adapter rewrite.
- DEP3: Windows window/capture/media APIs | reuse OS | unsupported or blocked = capability-specific degradation | availability bound: Windows/version/recorder | exit cost: native integration rewrite.
- Provider-side conversations/logs and model transmission follow each CLI/provider policy; Otto cannot promise their deletion.

## Flows
- Existing bootstrap (B1): launch -> K2/K5 top-center frameless WebView -> K1 static idle (not a verified Windows run).
- First complete slice (B2,B3,B8,B9,B10,B11,X1,X4,X7,X9,X10): enter Otto -> R1 selects visible context -> R7 validates Codex readiness and enforceable Quick Ask policy -> R2 accepts run_id -> K4 starts owned CLI -> ordered channel updates K1 -> user may collapse/reopen without stopping -> completed answer/quiet indicator -> follow-up, or explicit Stop -> terminal/cleanup -> original app regains attention.
- Permission break (B9,X7): provider requests tool action -> R7 records pending approval -> K1 shows actionable state / provider's supported approval path -> only valid user decision resumes; unavailable mechanism means block/stop.
- New Session (B9,X7): after a terminal run, user explicitly resets the conversation from Agent Settings -> R2 closes and waits for the owned provider process -> clears Rust transcript/thread/approval and returns to default Quick Ask; local unsent prompt and selected project remain editable. An active run or pending approval cannot be reset implicitly.
- Interruption (B8,X4,X10): collapse/switch = continue; Stop = cancel owned run and reject late output; app exit = terminate owned child work; crash/restart = show only independently verifiable provider history, otherwise interrupted/unknown.
- Capture (B4,X2,X6,X8): explicit hotkey -> R3 verifies assigned shortcut + pinned non-Otto target + capability -> capture -> user-chosen provider receives image -> response -> delete temp. Invalid/denied -> nothing submitted.
- Media (B5,X3): R4 observes OS session -> K1 shows state/absence -> supported playback action -> observe new state; lyrics unavailable remains explicit.
- Timer (B6): configure -> R5 records deadline -> derived remaining time -> pause/resume/reset -> quiet update via R1.
- Shell (B1,B2,B7,B10,X5): R6 positions/requests capture protection -> R1 renders -> hover preview no focus theft -> user activation controls focus/expanded state -> background updates do not select a new view; unsupported capture exclusion is disclosed.

## Guarantees
- G1 (B4,Q5,C6) [H]: without an explicit user capture action, no image is captured/submitted; SLI unauthorized capture/send invocations = 0 per invocation trace at R3 boundary (no image logging).
- G2 (B3,X4) [H]: after Stop or app exit, owned CLI process-tree survivors = 0; Windows Codex children are attached to a kill-on-close Job Object and launch fails closed if attachment fails. Assignment occurs after spawn, so wrapper pre-assignment races and crash behavior still need representative Windows proof.
- G3 (Q2) [M]: navigation/Stop remain responsive while CLI is busy; SLI p95 input-to-view response and frame intervals at WebView/host; target TBD from A2, no invented latency SLO.
- G4 (B1,B7,X5) [M]: UI remains accessible while protected capture support is best effort; signal native bounds/focus and supported-recorder capture outcome at R6; never guarantee all recorders.
- G5 (Q1) [M]: measure idle CPU/private memory of Otto+WebView2 process family separately from CLI and capture p95 frame intervals during morphing at OS/WebView; targets TBD from A2.
- G6 (B9,C7) [H]: Quick Ask never starts a CLI mode that can change project files without an enforceable restriction; SLI unauthorized write-capable launches = 0 at R7 launch-policy boundary.
- G7 (B8,X10) [H]: collapse/switch never cancels or loses an accepted run; SLI implicit cancellations on UI-only transitions = 0, observed at R2 run state and K1 event reconciliation. Restart must not fabricate completion.
- G8 (B9,X7) [H]: tool work requiring approval never runs before a valid decision; SLI unauthorized approval continuations = 0 at R7 approval/adapter boundary.
- G9 (B10,Q4) [M]: background completion does not change active feature or take keyboard focus; SLI unsolicited focus/active-view changes = 0, measured at R1/R6 transitions.
- G10 (B11,X1,X9,Q3) [M]: absent/unauthenticated/unsupported providers cannot accept runs; SLI accepted requests with invalid readiness = 0, measured at R7 validation/submit boundary.
- G11 (J1,Q6) [M]: user can obtain and reuse an answer without launching another app; SLI successful ask -> answer -> return-to-origin journey on a Windows walkthrough; success threshold not yet set (A7).

## Challenge
| H flow | Failure / threat | Blast radius | Containment | Detection signal | Recovery |
| --- | --- | --- | --- | --- | --- |
| G1 capture | implicit trigger, wrong target or sensitive image sent | screen privacy | only explicit hotkey; pin/recheck target; capability gate | R3 send provenance vs action | reject capture, delete temp, ask user to retry |
| G2 agent exit | CLI descendants remain alive, stale stream after Stop | local tools/resources and misleading answer | owner-scoped process tree; terminal run state | R2 process exits, surviving descendants, late event count | terminate owned tree, mark run cancelled |
| G6 Quick Ask | provider flag ignored/unsupported, write-capable session starts | local project files | deny unknown capability, use proven read-only provider mode | R7 policy outcome vs launch mode | refuse Quick Ask, show provider-specific limitation |
| G7 continuity | UI unmount/collapse drops stream or cancels CLI | active conversation | run owned outside view; replay buffered current result by run_id | R2 transition and K1 resubscription gap | resubscribe/reconcile, mark interrupted only if genuinely lost |
| G8 approval | auto-approval or adapter mishandles pending request | filesystem/tool side effects | explicit approval state, never infer permission | R7 approval transitions / pending actions | block action and notify user |

## Decisions
- DEC1 [one-way]: owner chose Tauri 2 + React/Vite/Tailwind + Rust/Bun over native Slint for faster UI iteration. Trade-off: WebView2 process/memory and window composition behavior; revisit only if representative Q1/Q2 measurements show a material problem.
- DEC2 [two-way]: one modular desktop app and feature-owned states over additional service/global store. Trade-off: in-process crash affects the shell; revisit for proven isolation need.
- DEC3 [two-way]: provider-specific structured protocols and ordered run channels over generic terminal text/events for high-frequency streaming. Trade-off: more adapter work; revisit with real CLI protocol constraints.
- DEC4 [two-way]: Windows 11 native APIs and best-effort capture protection over cross-platform parity. Trade-off: recorder/fullscreen incompatibility; revisit when tested scenarios require it.
- DEC5 [one-way]: enforce Quick Ask privilege at Rust/provider boundary or reject that mode. Alternative: UI-only warning (rejected because it cannot satisfy C7); trade-off: some providers unsupported until verified.
- DEC6 [two-way]: Otto does not store provider credentials, screenshots or an independent durable conversation database by default. Trade-off: crash recovery limited to provider-verifiable history; revisit if P12 needs stronger durability.
- DEC7 [two-way]: Agent Session ships as `workspace-write` + `on-request` (Codex `AskForApproval`) with only `accept` (Allow once) and `cancel` (Deny) decisions; `decline` is used for Quick Ask and fail-closed rejections. `permissions/requestApproval`, `acceptForSession`, and exec/network-policy amendments are out of scope and answered `decline`. Trade-off: no session-wide or policy amendment from Otto; revisit when the approval contract is verified on a real Windows run.
- DEC8 [one-way]: the provider's raw JSON-RPC request id stays private in the adapter; K1 only receives an opaque Otto `approvalId`. Rejected alternatives: exposing provider ids (leaks adapter shape and invites stale resolution) and auto-approving unsupported requests (violates G8).
- DEC9 [two-way]: mode and working directory are fixed for an existing conversation; changing them requires a new session. Trade-off: no in-place mode switch; prevents silently escalating or dropping a live thread's approval policy.

## Fitness
- F1: Tauri imports and native event wiring exist only in `src/platform/`; render-only feature TSX has no runtime platform imports (type-only snapshot imports allowed) | signal: TypeScript import scan | tool: `scripts/frontend-rules.mjs` | pass: zero boundary violations | cadence: PR | mode: enforce; exceptions -> D#.
- F2: feature modules import sibling features only via public `index.ts`; `shared/ui` never imports feature or platform code | signal: TypeScript import scan | tool: `scripts/frontend-rules.mjs` | pass: zero boundary violations | cadence: PR | mode: enforce; exceptions -> D#.
- F3: UI uses shared semantic design tokens from `src/style.css`, not new hard-coded palette values per component | signal: changed CSS/TSX | tool: `scripts/frontend-rules.mjs` R1/R2 | pass: no raw color literal in TS, none in CSS outside `@theme` | cadence: PR | mode: enforce (ratchet vs `.agents/frontend-budget.json`); exceptions -> D#.
- F4: the frontend does not grow more complex than the recorded budget | signal: largest component file, features missing a public entry, total Biome diagnostics, aria-label count, hand-drawn SVG count | tool: `scripts/frontend-rules.mjs` R3–R7 | pass: each metric ≤ its baseline | cadence: PR | mode: enforce as a ratchet — lower it freely, never raise it to pass; exceptions -> D#.
- F5: icons are a vetted dependency and accessible names are rendered text | signal: `lucide-react` in `package.json`/lockfile, `shared/ui` as the only icon source, no `aria-label` | tool: `scripts/frontend-rules.mjs` R6/R7 | pass: 0 `aria-label`, 0 inline `<svg>` outside `shared/ui` | cadence: PR | mode: enforce; exceptions -> D#.
- `bun run check` runs Biome and then the ratchet, so F1–F4 are executed at PR cadence and are proof when it exits 0. Baseline lives in `.agents/frontend-budget.json`; regenerate it only after a real reduction with `bun run lint:frontend -- --write-baseline`.

## Verification
- **Critical-proof contract (P#/X#/G#):** changed core state/policy, authorization/approval, provider lifecycle/Stop, concurrent ordering, capture consent/target, and restart/recovery must have behavior-based automated proof. Prefer unit tests for core decisions; use real boundary integration where a unit test cannot prove the invariant. Reuse existing tests if they genuinely fail for the defect; no test-count or coverage quotas.
- **TDD default for critical logic:** name the property and failure → observe Red on a targeted regression test → minimum Green implementation → Refactor. Red must fail for the intended behavior, not just broken setup. If a faithful Red cannot be observed, explain the exception in the PR and show the closest reliable behavior proof. A critical proof must detect the regression; mocked calls, constants and implementation snapshots alone do not qualify.
- `iter`: affected Rust core unit tests via `cargo test --manifest-path src-tauri/Cargo.toml` (focused filter when useful), plus relevant Rustfmt/Clippy or `bun run check`/build; no routine manual QA or browser E2E.
- `pr`: `bun run check`, `bun run build`, Rustfmt, `cargo check`, `cargo test`, Clippy on the exact HEAD using the existing Windows workflow. Review must map changed critical P#/X#/G# to a specific existing/new proof and block missing/ceremonial proof; do not add a second CI.
- PF1 (P3/P9,G6/G8) [critical]: enforceable read-only mode and approval deny/stale authorization | Rust policy/protocol unit | `iter/pr`.
- PF2 (P3/P8,G2/G7) [critical]: stream ordering, Stop vs completion, new-session ownership and interruption | Rust state-machine unit; owned process-tree acceptance needs native Windows | `iter/pr`, native at `release`.
- PF3 (P4/P11,G1) [critical]: explicit capture action, target identity, no implicit send on invalid/ambiguous state | Rust capture unit; Windows capture-to-Codex acceptance | `iter/pr`, native at `release`.
- PF4 (P12,X10,G7) [critical]: active marker → crash/restart → interrupted, no false completion; stale run cannot clear new marker | Rust unit + filesystem/runtime integration | `iter/pr`; representative restart at `release`.
- `merge`: review actual changed invariants and exact-SHA proof; never call unverified boundaries green.
- `release`: once per release candidate, NSIS startup, genuine Windows CLI/capture/session recovery and process cleanup; one exploratory acceptance pass. Live provider authentication and OS semantics are not proven by mocked unit tests.
## Release
- `master` integrates unreleased changes; commit SHA identifies internal builds. Distributed Windows builds use synchronized `0.x.y` manifest versions: meaningful user-facing feature = minor, fix = patch; docs/chore/refactor do not trigger their own releases.
- Batch releasable changes after verified merge and an Approve / Approve with Minor review; no release per merge and no release branch. Use an optional `-beta.N` GitHub prerelease only when external validation of a risky feature is necessary.
- Build NSIS from the verified source SHA with reproducible locks; publish only with explicit authorization as a **new immutable** `vX.Y.Z` tag and GitHub Release with artifact checksum/identity. No automatic publish on PR merge.
- Curate short user-impact release notes (normally ≤5 lines); `CHANGELOG.md` is optional until repeated distributions justify it. Describe compatibility changes and known limitations; internal commit messages are not release notes.
- Recovery: preserve a known-good compatible installer; use a corrected newer release when local state or provider side effects make downgrade unsafe. Publishing automation is deferred until the first actual Windows distribution, never silently enabled.

## Assumptions / Risks
- A6 [non-blocking]: Bun and Cargo lockfiles are not yet resolved/committed; do not assert CI reproducibility.
- A7 [non-blocking]: Q1/Q2/Q6 numerical budgets and observation window are undefined pending representative Windows baseline/task run; no fake SLO.
- Risks/trade-offs (top 3): (1) unverified provider read-only/approval capability vs portability; (2) owned process-tree/cancel safety vs CLI lifecycle diversity; (3) WebView2 rendering/resource and Windows capture limitations vs faster React UI delivery.
