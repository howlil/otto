# Product — Otto

## Problem
- Actor / Acceptor: Windows desktop user / owner.
- Trigger: A question or screen issue arises while the user is working inside another application.
- Current behavior: The user must interact with a separate AI CLI interface for assistance; Otto's current repository only has a static idle scaffold.
- Problem: Asking for assistance, providing context, and retrieving the answer can interrupt the active task.
- J1: When I need help during a desktop task, I want an answer without losing my current context, so I can return to the task with minimal interruption.

## Behavior
Primary journey: working in another app → B1 idle availability → B2 invoke → B11 provider ready → B9 context and interaction mode → B3 ask/receive answer → B8 collapse/reopen if needed → B10 discreet completion → resume original task.
Alternate context path: B2 → B4 user-triggered screen capture → B3 answer. Supporting modes: B5 music and B6 timer; B7 placement applies to all surfaces.

- B1: Otto defaults to an eyes-only Compact idle capsule while the user works elsewhere; other ambient information may be explicitly selected as a later idle presentation.
- B2: Every module has Compact and Expanded presentations. Hover morphs Compact into a non-focusing Expanded preview; explicit click/keyboard activation pins it for interaction. Expanded Home provides the module entry points, with an operable keyboard alternative to any gesture; dismiss/Escape returns to Compact.
- B3: User chooses an installed Codex, Pi, or Agy CLI, asks a question, sees partial/final responses, can follow up in the same provider session, and can explicitly stop the current request.
- B4: An explicit camera action or configured hotkey intentionally captures the last focused non-Otto window without flash/selection UI, sends that image to a selected CLI with image support, and shows the analysis; full-screen capture is an explicit alternative.
- B5: Music Compact shows circular artwork, song/artist, and playback-linked activity spectrum; Expanded adds playback details/actions. The spectrum stops when playback stops; lyrics appear only when a source provides them.
- B6: Pomodoro Compact shows remaining time, phase and a primary control, with no progress line/timeline/percentage or ring; Expanded enables focus/short/long-break durations and phase selection, start/pause/resume/reset, with restrained state-change and completion motion and no progress bar or ring.
- B7: User selects floating or top-attached placement; the capsule morphs into a rounded Expanded card. Attached uses curved shoulders connected to the screen edge; both placements preserve interaction without trapping or obscuring unrelated desktop actions. Otto requests an untitled native tool window to reduce Window source-picker listings where capture backends filter untitled or tool windows.
- B8: Collapsing Otto, switching feature, or returning focus to another app does not cancel an active AI request; reopening reveals ongoing output or its completed answer. Explicit Stop cancels; exiting Otto ends owned active work.
- B9: Before starting agent work, user can see the selected provider and working project/context. Quick Ask is the default, with no file-changing actions; entering an Agent Session or approving a tool action requires an explicit user choice. An approval request visibly waits for a valid decision.
- B10: Background AI, music, or timer updates never switch the active feature or seize keyboard focus; completed AI work appears as a quiet 'Answer ready' status that can be opened on demand.
- B11: Provider setup exposes whether the CLI is ready, needs authentication/setup, or lacks a required capability; user can recover or select another provider without losing a draft.

Material breaks:
- X1 (B3,B11): CLI absent, incompatible, or fails → explain, preserve draft/session context, offer setup, retry, or provider switch.
- X2 (B4): Capture permission unavailable or provider cannot take images → no upload/submission; show a recoverable reason.
- X3 (B5): No media session/lyrics source → show an accurate empty or unavailable state, not invented content.
- X4 (B3,B8): User explicitly stops or exits during a run → terminate owned work; no late response becomes current; collapse alone never triggers cancellation.
- X5 (B1,B7): OS/recorder ignores pixel exclusion or lists tool windows as shareable sources → never promise universal invisibility, process hiding, or picker exclusion; retain usable UI and communicate limitations.
- X6 (B4): Last focused external window no longer exists or is ambiguous → do not silently capture a different target; offer user-controlled retry/selection.
- X7 (B9): CLI requires a tool approval → pause in an actionable waiting state; never auto-approve or mislabel an unattended action as safe.
- X8 (B4): Capture hotkey conflicts with another shortcut or cannot register → show conflict and allow reassignment; never silently capture.
- X9 (B11): CLI exists but authentication/session expired → show setup/sign-in required; do not falsely mark it ready.
- X10 (B8): After app restart, an interrupted CLI session cannot be recovered → distinguish finished history from interrupted/unknown state, never fabricate a completed answer.


## Constraints
- C1: Windows 11 first; Tauri 2 + React + Vite + Rust + Tailwind CSS, Bun for JS package management/scripts.
- C2: Use locally installed Codex, Pi, and Agy CLIs with their existing authentication; no separate AI API, hosted model gateway, or backend service.
- C3: Low idle resource usage, responsive interface, and recoverable external dependencies.
- C4: Always-on-top and capture exclusion are best effort; secure desktop, fullscreen modes, and third-party capture paths may behave differently.
- C5: Compact dark UI; UIArc is a visual reference, not a runtime dependency.
- C6: Capture and image transmission happen only after an explicit configured user action; do not perform periodic/automatic screenshots.
- C7: Quick Ask must not claim read-only behavior unless it is enforceable for that provider; file-changing operations require explicit agent-mode choice and applicable CLI approvals.
- Q1: Measure Windows idle CPU/memory and interaction frame pacing on a representative machine; numeric thresholds remain undefined pending baseline (A2).
- Q2: During CLI execution, users can still navigate, collapse, reopen, and stop without UI freezing; record interaction responsiveness during a real run.
- Q3: Invalid/unsupported provider, media, hotkey, or capture capability leaves a clear recoverable state, not a misleading success indication.
- Q4: Background activity must not unexpectedly change active view or keyboard focus.
- Q5: Screen content must not be submitted without an explicit user capture action; the user can identify the intended capture target.
- Q6: User can obtain an answer and return to the original task without opening a separate AI interface.

## Scope
- Agent outcome in scope: compact Otto entry → select Codex, Pi or Agy and working context → provider-verified Quick Ask → streamed response → collapse/reopen → follow-up or Stop → recoverable failure. Codex Agent Session with explicit approvals and hotkey-triggered image analysis are additional required Agent behaviors. Codex and Pi accept screenshots only when selected provider/model confirms image input; Pi remains tool-free Quick Ask. Agy stream-json headless input accepts text blocks only, so screenshots are unsupported in this transport.
- Supporting product direction retained but not Agent completion prerequisites: configurable placement, media, Pomodoro, and optional idle information.
- Out: conversation extras (presets, quote, search, transcript export, rich Markdown/code controls), OpenCode provider, cloud backend, standalone model API credentials, universal capture invisibility, automatic screen surveillance, auto-approval of agent actions, database, telemetry server, auto-updater, multi-OS parity, speculative plugin system.

## Proof
- P1 (B1,B7,X5): Given a supported Windows session, Otto remains accessible at the selected top location with the native tool-window style set; supported picker filtering and pixel exclusion require representative Windows acceptance, and limitations are accurately communicated.
- P2 (B2): Given any Compact module, hover reveals its Expanded preview without focus theft; click/keyboard activation pins the card; exiting/Escape restores Compact, and Expanded Home exposes all module entries without mandatory gesture navigation.
- P3 (B3,X1,X4): Given a ready CLI, asking produces a real partial/final answer and follow-up; a missing/failed CLI keeps the draft recoverable; explicit Stop/exit ends owned work without a stale answer.
- P4 (B4,X2,X6,Q5): Given a valid last-focused window and capable provider, only an intentional hotkey sends its image and returns analysis; denied, unsupported, missing or ambiguous targets send nothing and offer recovery.
- P5 (B5,X3): Given an active media session, Compact shows song/artist, circular cover and a spectrum only during playback; controls reflect observed state, and absent sessions/lyrics do not display fabricated data.
- P6 (B6): Given configured focus/break durations, Compact and Expanded show the correct countdown/phase with no progress timeline/bar or ring; start, pause, resume, reset, phase selection and Expanded settings preserve the selected durations without background focus theft.
- P7 (Q1,Q2): Given a representative Windows build, record idle resource use and interaction/frame timing while a CLI executes; gestures/navigation and Stop remain responsive, with no invented benchmark pass.
- P8 (B8): Given streaming AI output, when Otto collapses or another feature opens, the run continues and reopening restores the same session and available output; only Stop/exit terminates owned work.
- P9 (B9,X7,C7): Given a selected provider/context, the user can distinguish Quick Ask from Agent Session; when approval is required, execution visibly waits and cannot continue without a valid approval path.
- P10 (B10,Q4): Given the user reads AI output, when music/timer updates or AI completes in background, the active feature and keyboard focus do not switch; 'Answer ready' is accessible without forced expansion.
- P11 (B11,X8,X9,Q3): Given a missing/unauthenticated/incompatible CLI or conflicting hotkey, the user sees the specific unavailable state and recovery action; no request or capture is silently executed.
- P12 (X10): Given an interrupted session followed by restart, Otto reports recovered state only if it actually exists; otherwise it labels the session interrupted/unknown and offers a fresh request.
- P13 (Q6): Given a question during another app task, the user can ask, read/copy/follow up on the answer, dismiss Otto, and return to the same task without switching to a standalone AI interface.

- P14 (B12,X11): Given active messages, formatted text/code remain readable during streaming without executing HTML; code copy, quote, search, and export/copy operate on those same messages. Presets edit drafts without sending, and export failure offers copy.

## Assumptions
- A1 [non-blocking]: Codex is the initial supported provider; specific capabilities of Pi and Agy will be checked against installed versions.
- A2 [non-blocking]: Hard performance budgets are deliberately undefined until Windows idle/active measurements exist.
- A3 [non-blocking]: Screenshot defaults to the last focused external window; full-screen capture requires an explicit alternative selection. Revisit when implementing B4 if source selection is inadequate.
- A4 [non-blocking]: Quick Ask defaults to a read-only experience; if a provider cannot enforce it, Quick Ask must be unavailable for that provider rather than silently permitting writes.
- A5 [non-blocking]: At first, resumed history is limited to sessions verifiably available from the selected provider; no independent cloud or history database.
