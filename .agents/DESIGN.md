---
colors: {surface: "#151515", text: "#FAFAFA", muted: "#A3A3A3"}
typography: {body: {family: "Segoe UI, system-ui, sans-serif", size: "14px"}}
spacing: {base: "4px"}
radius: {island: "9999px", expanded_card_reference: "28px", attached_shoulder_reference: "12px"}
motion: {ease: "cubic-bezier(0.22, 1, 0.36, 1)", reduced: "disable nonessential motion"}
---
# Design — Otto

## Direction
Product: a Windows desktop notch that lets someone ask a locally installed AI CLI for help without leaving the active task; music and Pomodoro are secondary modes.
Character: quiet, precise, gently expressive.
World: a small, dark instrument at the top edge of the working desktop; the surrounding window stays transparent.
Identity: idle Compact shows only paired robot eyes; active modules use task-specific identity. Keep the surrounding chrome restrained; subtle tonal gradients are reserved for approved module artwork, with no gratuitous glow or generic card layouts.
Per-surface moments and interaction graphs belong in the current PR/task, not in this durable file.

## Guardrails
- Tailwind CSS v4 is the default styling system: put static layout, alignment, spacing, and token colors in complete TSX utility classes; preserve custom notch geometry, SVG art, state selectors and motion in `src/style.css`. Do not duplicate layout declarations or construct utility names at runtime.
- `src/style.css` Tailwind `@theme` is the executable token source: surface/text/muted, `--font-otto-ui`, `--radius-otto-island`, `--ease-otto`. Reuse tokens and Tailwind's 4px spacing scale; do not scatter semantic literals in components. Add accent, controls or extra scales only with real usage.
- UIArc is a visual reference, not a dependency. Prioritize real provider/session/status content over ornamental effects; never simulate successful AI, media, or capture states.
- Floating and top-attached placements preserve the same available tasks; neither may create an invisible hit area that blocks unrelated desktop actions.
- Hover can reveal a preview but never takes keyboard focus. Only an explicit activation opens the interactive surface; dismissal returns attention to the prior desktop task.
- Background AI, music, and timer updates never force feature navigation or focus. A completed run uses a quiet status affordance that the user can open.
- Compact/expanded morphs preserve identity and content continuity; any gesture has a visible and keyboard-operable equivalent. No mandatory animation blocks an action.
- Do not reuse public-web LCP/INP/CLS as desktop quality targets. Observe Windows/WebView2 input, frame pacing, and resource behavior under representative conditions.

## Frontend visual baseline
- Canonical shared-shell reference: `design/otto-v9-baseline.html`. Approved module-specific references live at `design/<module>.html`; **Home/Idle + Global Settings: `design/home.html`**, **Agent: `design/agent.html`**, **Music: `design/music.html`**, **Focus/Pomodoro: `design/pomodoro.html`**. Before changing any module UI, open the matching reference if it exists and preserve its approved compact/expanded geometry, interaction states and motion. For modules without one, fall back to the shared-shell reference; never create placeholders. Standalone HTML/CSS/JS is a **prototype**, not the React implementation or evidence of native integration. Do not copy simulated state or OS/AI/media successes into production.
- OS Events: approved standalone interactive reference `design/os-events.html` (v7). This is a **transient Compact-only capsule**, not a fifth permanent Home module and **never Expanded**. Show only the event's essential status/level with a small context-specific SVG and one-shot, state-driven motion: acoustic waves + micro-meter for volume, short sun-aperture response for brightness, small device identity + connection state for Bluetooth peripherals, sequenced Wi-Fi arcs, and energy cells for charging/low battery. Keep icons/artwork proportional to the capsule, no large hardware illustrations, filler labels or generic card/progress template. Floating and curved-shoulder Attached use the shared shell; no unsolicited focus, no false connection/charging confirmations, and dismiss to the previous surface. The reference's event triggers, device states, timers, and battery values are simulated; native Rust must report confirmed OS state. Respect reduced motion.
- Every module (Home, Agent, Music, Focus) supports **Compact capsule** and **Expanded rounded card**. Home Compact is **only two eyes**, with no wordmark. Expanded Home is a 3-action launcher, not permanent navigation. Only the relevant module appears inside the notch; no always-visible tab bar or explicit Expand button.
- Floating: centered below the screen top edge. Attached: connected to the top edge through symmetric concave shoulders and rounded bottom corners, not a capsule simply cut off at the top. Keep the same information and actions in either placement; preserve an accurate native click/hit region. The reference adds ~12px shoulder per side, subject to Windows verification.
- **Reference sizes (logical/CSS px; tune against WebView2/DPI, not Apple point measurements):** Home 92×42 → 452×148; Agent 228×50 → 526×142–326 (content-dependent); Music 264×54 → 444×178; Focus 224×52 → 408×174. Arrows mean Compact → Expanded. Attached shoulder width is additional to the content body.
- Spacing: follow 4px rhythm; Compact horizontal padding around 10–12px, content-to-control gaps 8–12px; Expanded outer padding around 16–20px, group gaps 8–12px. Preserve icon/text baseline, use tabular countdown digits, and constrain conversation overflow inside the card. Circular Compact icons and album cover; approximately 32px icon controls with accessible hit targets. No countdown progress ring, gratuitous nested borders, filler subtitles, or oversized empty panels.
- Home/Idle: follow `design/home.html` for the eyes-only Compact, restrained three-card Expanded launcher, and Settings entered by its header gear. Preserve the Home 92×42 → 452×148 reference, existing label alignment and typography. Home cards use large (~two-thirds-card) lightweight SVG artwork with ~43° left-leaning perspective and stronger *tonal* gradient (prototype reference ~80%), kept behind legible labels. Depth/parallax is subtle, pointer-driven and non-looping; hover/press is reversible and reduced-motion removes optional transforms.
- Global Settings: `design/home.html` is the shared reference for an in-island General / Interaction / Motion / Placement surface, with Back/Escape and focus restoration. Settings cover idle expression/reactivity, hover intent and dismiss behavior, fluid/subtle/reduced motion, SVG tilt/gradient/parallax, and Floating/Attached with top offset. Use shared preferences for all modules rather than per-module duplicates. Prototype localStorage is illustrative, not a native persistence implementation; Windows-native placement, hit areas and reduced-motion behavior require separate verification.
- Agent: follow `design/agent.html` as the approved minimal composition. Compact shows observed CLI identity/status and activity bars **only** while thinking/streaming. Expanded keeps a quiet provider/project/mode/status header, scrollable transcript, and one capsule composer with Capture, prompt and Send/Stop. Provider choice, Quick Ask vs Agent Session, and working-project setup live in a secondary in-island Settings surface (gear, Back/Done/Escape, keyboard access); no provider dropdown inside the composer, permanent mode tabs or filler panels. Before submission keep provider, context and effective permission scope discoverable. Privileged tool actions require explicit permission enforced at the Rust/provider boundary, not by UI presentation.
- Music: follow `design/music.html` for the approved Compact, Player, and Lyrics interaction/motion. Compact has a circular cover, track and artist, and a spectrum-style activity indicator only while **real** playback is active; no invented audio-reactive waveform. Expanded has transport controls and a seekable timeline when the OS media session supports it. Lyrics is an optional, sourced subview: approximately 1:3 cover-to-lyrics width and a compact 444×212 reference panel, with auto-follow, manual-scroll override, follow recovery and per-line seek only when timestamps and seek capability are available. Prototype data and karaoke fill are demonstrations, never assumed OS capabilities. Focus: Compact shows remaining countdown, phase and a rounded primary control **without any progress line, timeline, percentage or ring**; Expanded keeps countdown, start/pause/resume/reset, focus/short/long-break controls and duration settings, also **without progress line or ring**. Follow `design/pomodoro.html` for approved state-feedback motion (start/resume spring response, pause settle, reset recoil, phase transition, settings reveal, one-shot completion cue and optional attention nudge). Motion presets Fluid/Expressive/Reduced are exploratory prototype preferences; only user-directed actions or meaningful state changes animate, never an idle loop. Keep focus safe and honor system reduced-motion.
- Agent event motion: subtle activity bars only for actual CLI work; one-shot completion feedback, approval attention cue and brief error shake are acceptable when event-driven. No idle loop, simulated progress, focus theft or excessive bounce. Settings stay inside the island; reduced motion preserves use without animation.
- Motion: top-center anchor, coherent silhouette width/height/radius interpolation, delayed content reveal, interruptible collapse/expand, minimal overshoot. Prototype spring-like ease and ~420ms shell morph, ~150ms hover intent, ~340ms pointer-leave delay are tuning references, not Windows performance claims. Hover may expand without stealing focus; explicit click/keyboard activation pins an interactive card until dismiss/Escape. Respect reduced motion.

## State
- UI-local: hovered/expanded state, active feature, input draft and local focus intent. Keep these near the owning feature, not in a global catch-all store.
- Native: placement, bounds, foreground/capture capability and focus policy are Rust-owned; UI reflects observed capability, not presumed success.
- Agent: provider readiness, run/session/output, cancellation and approvals are Rust-owned. Collapsing or changing features never implicitly stops a run; stale events never overwrite a terminal result.
- Timer and media show observed state from their designated feature/native owners; remaining timer time is derived from the authoritative deadline. Refer to `.agents/engineering.md` S1–S7 for exact ownership.
- Async variants are truthful and actionable: pending retains meaningful context; errors preserve drafts and explain recovery; denied/unsupported is distinct from success; stopped/interrupted is distinct from completed. Never render invented lyrics, answers, or recoveries.

## Patterns
- Entry: Compact idle/activity → non-focusing hover morph to Expanded → explicit click/keyboard activation pins the interactive card → dismiss/Escape to Compact. The hover-only card closes after pointer leave without stealing focus; required actions have a keyboard path. Treat the top-edge island as a desktop overlay, not a normal web route.
- Feature switching is user-directed and preserves independent background activity; show a provider/context label before AI submission.
- Quick Ask and Agent Session remain distinct *capability/permission states*, even without permanent mode buttons; explicit escalation and approval are required when an action may modify files. Tool approval is a waiting interaction, never an implicit confirmation.
- Use an expanded interactive surface for sustained reading, editing or approvals. Use non-interactive status for passive completion; it must not steal focus.
- Error and empty states name the unavailable capability and offer the next valid action (retry, configure, choose provider, or dismiss). Disable a temporarily unavailable action with a reason; hide actions that can never apply.
- Per-feature U/M/ST/V/N graph and X# recovery mapping stay in the implementing PR. Do not turn this file into a screen-by-screen specification.

## Frontend composition rules

Enforced by `bun run check` → `scripts/frontend-rules.mjs` against `.agents/frontend-budget.json`. The budget is a **ratchet**: a change may lower a number, never raise it. Fix the violation; do not edit the baseline upward.

```text
R1  no raw color literal in any src/**/*.{ts,tsx}       0
R2  no color literal in CSS outside the @theme block    <=107 (shrink as modules are tokenized)
R3  largest component file, lines                       <=205
R4  features missing a public index.ts entry            0
R5  total Biome diagnostics                             <=29
R6  aria-label attributes                               0 (render the name instead)
R7  hand-drawn <svg> outside src/shared/ui              0 (use shared/ui icons)
```

Build every screen block by block, component by component, from shared primitives; do not grow one file into a screen.

```text
src/shared/ui/     Icon (lucide), IconButton, VisuallyHidden, Eyes,
                   Bars, ChoiceChip, ChoiceRow, Range, Toggle
src/features/
  shell/           preferences, useNotchShell, GlobalSettings
  home/            HomeCard
  agent/           AgentPanel (container)
                   AgentCapsule, AgentSettings, AgentTranscript, ApprovalCard
                   surface.ts (surface + compact copy), status.ts, useAgent
src/platform/      typed Tauri transport
```

- **Layers**: `ui` (render-only, props in / events out) ← `feature` (state, effects, IPC) ← `data` (`src/platform`). `ui` never imports `feature`; components never call the Tauri transport directly.
- **Shared primitives** live in `src/shared/ui` and appear at the third real reuse, not the second. A repeated control (icon button, choice chip, range, toggle, status marker) is a component, not a copy of the same CSS rule and inline SVG.
- **Feature modules**: one directory per capability with a public `index.ts`; import a sibling feature only through that entry.
- **File size**: a component file that stops being a component gets split by responsibility (panel, card, controls), never by line count. `noExcessiveLinesPerFunction` / `noExcessiveCognitiveComplexity` are Biome warnings that count toward R5 — extract, do not suppress.
- **Icons**: real icon set, `lucide-react` pinned by the lockfile. `shared/ui` maps a role name (`settings`, `alert`, `terminal`) to the component; features never import lucide directly and never draw an `<svg>`.
- **Accessible names**: an icon-only control carries real text, hidden with `VisuallyHidden` (or `IconButton`, which pairs both). Do not use `aria-label`; a dialog or region is named by its visible heading via `aria-labelledby`. Icons are `aria-hidden` decorative glyphs — the name belongs to the control.
- **Status text** is derived in one place (`features/agent/status.ts`, `surface.ts`), not by nested ternaries at each render site.
- **Styling**: static layout/spacing/token colors are Tailwind utilities in TSX; `src/style.css` keeps geometry, state selectors, artwork and motion. Semantic colors come from `@theme`; add a token rather than a new literal.

## Quality targets
| Gate | Metric / target | Evidence |
| --- | --- | --- |
| UG1 Reachability | 100% of in-scope B# map to an operable M# → U# path; addressable views have navigation if the app actually supports deep links/back | Design graph in feature PR |
| UG2 Recovery | 100% of in-scope X# have a visible, recoverable V#; no dead-end retry or false success | Flow review and targeted behavior proof |
| UG3 Ownership | Exactly one authoritative owner for each consequential ST#; no UI copy of Rust agent/run truth | Compare graph against engineering S# |
| UG4 Task success | Each in-scope P# can complete its intended task and return to the original app; record completion, elapsed time and errors together when observed, without inventing a success percentage | Representative Windows task walkthrough |
| UG5 Focus safety | 0 unsolicited focus or active-feature changes on hover, pending work, background completion or collapse | Focus/active-view transition observation |
| UG6 Responsiveness | Observe p95 action-to-visible response and frame intervals during active CLI streaming and notch morphing; numeric targets TBD until a Windows baseline (Q1/Q2, A2/A7) | Representative Windows build, not browser-only animation |
| UG7 Idle cost | Measure idle CPU and private memory for Otto + WebView2 separately from CLI processes; numeric targets TBD until baseline (Q1/G5) | Windows process-family observation |

These are product/interface gates, not a request for new CI workflows, standalone test plans or invented benchmark pass results.

## Accessibility
- Baseline WCAG 2.2 AA: text contrast ≥ 4.5:1 for normal text, non-text UI/indicators ≥ 3:1; interactive targets ≥ 24×24 CSS px or satisfy the applicable spacing exception.
- Every essential move is keyboard-operable with visible focus. Hover and two-finger navigation have an equivalent explicit control; focused overlays have an exit and valid focus restoration.
- Important async results, validation failures, and approval requests are perceptible through visible status and appropriate announcements; passive status does not hijack focus.
- Honor `prefers-reduced-motion`: remove nonessential morph/translation and preserve the same usable state changes without animation.
- Platform contrast, pointer hit area, focus restoration and capture exclusion require representative Windows verification; a Vite render is not native proof.
