---
colors: {surface: "#151515", text: "#FAFAFA", muted: "#A3A3A3"}
typography: {body: {family: "Segoe UI, system-ui, sans-serif", size: "14px"}}
spacing: {base: "4px"}
radius: {island: "9999px"}
motion: {ease: "cubic-bezier(0.22, 1, 0.36, 1)", reduced: "disable nonessential motion"}
---
# Design — Otto

## Direction
Product: a Windows desktop notch that lets someone ask a locally installed AI CLI for help without leaving the active task; music and Pomodoro are secondary modes.
Character: quiet, precise, gently expressive.
World: a small, dark instrument at the top edge of the working desktop; the surrounding window stays transparent.
Identity: paired robot eyes identify idle Otto, not every state. Keep the surrounding chrome restrained; no decorative gradients, gratuitous glow, or generic card layouts.
Per-surface moments and interaction graphs belong in the current PR/task, not in this durable file.

## Guardrails
- `src/style.css` Tailwind `@theme` is the executable token source: surface/text/muted, `--font-otto-ui`, `--radius-otto-island`, `--ease-otto`. Reuse tokens and Tailwind's 4px spacing scale; do not scatter semantic literals in components. Add accent, controls or extra scales only with real usage.
- UIArc is a visual reference, not a dependency. Prioritize real provider/session/status content over ornamental effects; never simulate successful AI, media, or capture states.
- Floating and top-attached placements preserve the same available tasks; neither may create an invisible hit area that blocks unrelated desktop actions.
- Hover can reveal a preview but never takes keyboard focus. Only an explicit activation opens the interactive surface; dismissal returns attention to the prior desktop task.
- Background AI, music, and timer updates never force feature navigation or focus. A completed run uses a quiet status affordance that the user can open.
- Compact/expanded morphs preserve identity and content continuity; any gesture has a visible and keyboard-operable equivalent. No mandatory animation blocks an action.
- Do not reuse public-web LCP/INP/CLS as desktop quality targets. Observe Windows/WebView2 input, frame pacing, and resource behavior under representative conditions.

## State
- UI-local: hovered/expanded state, active feature, input draft and local focus intent. Keep these near the owning feature, not in a global catch-all store.
- Native: placement, bounds, foreground/capture capability and focus policy are Rust-owned; UI reflects observed capability, not presumed success.
- Agent: provider readiness, run/session/output, cancellation and approvals are Rust-owned. Collapsing or changing features never implicitly stops a run; stale events never overwrite a terminal result.
- Timer and media show observed state from their designated feature/native owners; remaining timer time is derived from the authoritative deadline. Refer to `.agents/engineering.md` S1–S7 for exact ownership.
- Async variants are truthful and actionable: pending retains meaningful context; errors preserve drafts and explain recovery; denied/unsupported is distinct from success; stopped/interrupted is distinct from completed. Never render invented lyrics, answers, or recoveries.

## Patterns
- Entry: idle → non-activating compact preview → explicitly activated expanded feature → dismiss/back to idle. Treat the top-edge island as a desktop overlay, not a normal web route.
- Feature switching is user-directed and preserves independent background activity; show a provider/context label before AI submission.
- Quick Ask and Agent Session must have distinct affordances and explicit permission context. Tool approval is a waiting interaction, never an implicit confirmation.
- Use an expanded interactive surface for sustained reading, editing or approvals. Use non-interactive status for passive completion; it must not steal focus.
- Error and empty states name the unavailable capability and offer the next valid action (retry, configure, choose provider, or dismiss). Disable a temporarily unavailable action with a reason; hide actions that can never apply.
- Per-feature U/M/ST/V/N graph and X# recovery mapping stay in the implementing PR. Do not turn this file into a screen-by-screen specification.

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
