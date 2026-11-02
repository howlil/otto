# Product — Otto

## Problem
- Actor / Acceptor: Windows desktop user / owner.
- Trigger: A question or screen issue arises while the user is working inside another application.
- Current behavior: The user must interact with a separate AI CLI interface for assistance; Otto's current repository only has a static idle scaffold.
- Problem: Asking for assistance, providing context, and retrieving the answer can interrupt the active task.
- J1: When I need reasoning, domain knowledge, learning explanations or coding help during desktop work, I want Otto to support my task without switching to an external CLI or losing context.

## Behavior
Primary journey (Assistant, existing): B1 idle → B2 invoke → B11 runtime ready → B9 tool-free Assistant → B3 streaming answer → B8 collapse/reopen → B10 completion. Coding target: B13 choose Coding/workspace → validate capabilities/permissions → authorized inspect/edit/test → result.
Alternate context path: B2 → B4 user-triggered screen capture → B3 answer. Supporting modes: B5 music and B6 timer; B7 placement applies to all surfaces.

- B1: Otto allows only one host instance per Windows login session, then defaults to an eyes-only Compact idle capsule. Duplicate launches exit without creating another window, capturing focus, or resetting the active chat conversation. Other ambient information may be explicitly selected later.
- B2: Every module has Compact and Expanded presentations. Hover morphs Compact into a non-focusing Expanded preview; explicit click/keyboard activation pins it for interaction. Expanded Home provides the module entry points, with an operable keyboard alternative to any gesture; dismiss/Escape returns to Compact. Saved Keep Expanded governs pinned auto-collapse on desktop blur, not transient hover previews.
- B3: User chooses an installed Codex, Pi or Agy runtime and supported model/thinking, asks and follows up with streaming output and Stop; the selected runtime does not own Otto conversation identity.
- B4: An explicit camera action or configured hotkey intentionally captures the last focused non-Otto window without flash/selection UI, sends that image to a selected CLI with image support, and shows the analysis; full-screen capture is an explicit alternative.
- B5: Music Compact shows circular artwork, song/artist, and playback-linked activity spectrum; Expanded adds playback details/actions. The spectrum stops when playback stops; lyrics appear only when a source provides them.
- B6: Pomodoro Compact shows remaining time, phase and a primary control, with no progress line/timeline/percentage or ring; Expanded enables focus/short/long-break durations and phase selection, start/pause/resume/reset, with restrained state-change and completion motion and no progress bar or ring.
- B7: User selects floating or top-attached placement; the capsule morphs into a rounded Expanded card. Attached uses curved shoulders connected to the screen edge; both placements preserve interaction without trapping or obscuring unrelated desktop actions. Otto requests an untitled native tool window to reduce Window source-picker listings where capture backends filter untitled or tool windows.
- B8: Collapsing Otto, switching feature, or returning focus to another app does not cancel an active AI request; reopening reveals ongoing output or its completed answer. Explicit Stop cancels; exiting Otto ends owned active work.
- B9: Assistant Mode answers open-ended domain, learning, logic and code questions, with model/thinking selection and no model tool, command, file-write or approval effects; no special learning/quiz engine.
- B10: Background AI, music, or timer updates never switch the active feature or seize keyboard focus; completed AI work appears as a quiet 'Answer ready' status that can be opened on demand.
- B11: Provider setup exposes whether the CLI is ready, needs authentication/setup, or lacks a required capability; user can recover or select another provider without losing a draft.
- B12: Streaming answers render Markdown, code and math safely, support copying, and never execute model-supplied HTML.
- B13: Coding Mode explicitly selects workspace and runtime; inspecting, editing and testing are allowed only after capability/scope validation, with approval before effects where required. Unsupported isolation/approval disables affected actions.
- B14: Otto-owned conversation and history survive runtime/model switching between turns; when a native session cannot resume, reconstruct only bounded saved transcript context and label the limitation.

Material breaks:
- X1 (B3,B11): CLI absent, incompatible, or fails → explain, preserve draft/session context, offer setup, retry, or provider switch.
- X2 (B4): Capture permission unavailable or provider cannot take images → no upload/submission; show a recoverable reason.
- X3 (B5): No media session/lyrics source → show an accurate empty or unavailable state, not invented content.
- X4 (B3,B8): User explicitly stops or exits during a run → terminate owned work; no late response becomes current; collapse alone never triggers cancellation.
- X5 (B1,B7): User-configurable best-effort Windows capture exclusion defaults ON; a change requires native readback before the local preference is persisted. Recorders may still capture or list Otto. Never promise universal invisibility, process hiding or picker exclusion; failed settings preserve the reported native state and offer retry.
- X6 (B4): Last focused external window no longer exists or is ambiguous → do not silently capture a different target; offer user-controlled retry/selection.
- X7 (B9,B13): Assistant tool/approval requests fail closed; Coding actions without verified scope or approval are denied before effects, not auto-approved or silently continued.
- X8 (B4): Capture hotkey conflicts with another shortcut or cannot register → show conflict and allow reassignment; never silently capture.
- X9 (B11): CLI exists but authentication/session expired → show setup/sign-in required; do not falsely mark it ready.
- X10 (B8): After app restart, an interrupted CLI session cannot be recovered → distinguish finished history from interrupted/unknown state, never fabricate a completed answer.
- X11 (B12): Unsafe provider HTML, links or partial Markdown → inert rendering; no model-supplied script execution.
- X12 (B13): No verified Coding scope/approval enforcement → deny action, preserve draft/conversation and explain recovery.
- X13 (B14): Switch cannot recover exact native provider context → show bounded transcript reconstruction, never claim exact native resume.


## Constraints
- C1: Windows 11 first; Tauri 2 + React + Vite + Rust + Tailwind CSS, Bun for JS package management/scripts.
- C2: Use locally installed Codex, Pi, and Agy CLIs with their existing authentication; no separate AI API, hosted model gateway, or backend service.
- C3: Low idle resource usage, responsive interface, and recoverable external dependencies.
- C4: Always-on-top and capture exclusion are best effort; secure desktop, fullscreen modes, and third-party capture paths may behave differently.
- C5: Compact dark UI; UIArc is a visual reference, not a runtime dependency.
- C6: Capture and image transmission happen only after an explicit configured user action; do not perform periodic/automatic screenshots.
- C7: Assistant launch requires proven tool-disabled behavior. Coding actions require verifiable workspace scope and pre-effect runtime/OS permission enforcement; prompt instructions, read-only labels, Job Objects or post-hoc events are insufficient.
- C8: Otto owns conversation identity, execution lifecycle, prepared context and mode policy; external CLI/runtime and model capabilities are negotiated, not imported into core business logic.
- Q1: Measure Windows idle CPU/memory and interaction frame pacing on a representative machine; numeric thresholds remain undefined pending baseline (A2).
- Q2: During CLI execution, users can still navigate, collapse, reopen, and stop without UI freezing; record interaction responsiveness during a real run.
- Q3: Invalid/unsupported provider, media, hotkey, or capture capability leaves a clear recoverable state, not a misleading success indication.
- Q4: Background activity must not unexpectedly change active view or keyboard focus.
- Q5: Screen content must not be submitted without an explicit user capture action; the user can identify the intended capture target.
- Q6: User can obtain an answer and return to the original task without opening a separate AI interface.

## Scope
- Agent scope: Assistant (current) uses installed CLIs for streaming chat, reasoning, model/thinking selection, safe Markdown, screenshot analysis, local history, Stop and collapse/reopen; Coding (future target, NOT implemented by this documentation PR) adds explicit workspace, authorized inspect/edit/test, tool activity and pre-effect approval. Codex/Pi image input remains capability-gated; Agy headless is text-only until verified otherwise.
- Supporting product direction retained but not Agent completion prerequisites: configurable placement, media, Pomodoro, and optional idle information.
- Out: dedicated learning/quiz engine, multi-agent orchestration, dynamic plugin loader, universal feature parity or native-session migration, direct model API/cloud gateway, automatic screen surveillance, speculative database/services and multi-OS parity. Tool execution and workspace access remain out of Assistant and gated in future Coding.

## Proof
- P1 (B1,B7,X5): Given a supported Windows session, exactly one Otto host starts; duplicate and concurrent launches exit before native window/hotkey initialization, and the first instance keeps its active chat transport/history. The native tool-window style remains set; picker filtering and pixel exclusion require representative Windows acceptance.
- P2 (B2): Given any Compact module, hover reveals its Expanded preview without focus theft; click/keyboard activation pins the card; exiting/Escape restores Compact, and Expanded Home exposes all module entries without mandatory gesture navigation.
- P3 (B3,X1,X4): Given a ready CLI, asking produces a real partial/final answer and follow-up; a missing/failed CLI keeps the draft recoverable; explicit Stop/exit ends owned work without a stale answer.
- P4 (B4,X2,X6,Q5): Given a valid last-focused window and capable provider, only an intentional hotkey sends its image and returns analysis; denied, unsupported, missing or ambiguous targets send nothing and offer recovery.
- P5 (B5,X3): Given an active media session, Compact shows song/artist, circular cover and a spectrum only during playback; controls reflect observed state, and absent sessions/lyrics do not display fabricated data.
- P6 (B6): Given configured focus/break durations, Compact and Expanded show the correct countdown/phase with no progress timeline/bar or ring; start, pause, resume, reset, phase selection and Expanded settings preserve the selected durations without background focus theft.
- P7 (Q1,Q2): Given a representative Windows build, record idle resource use and interaction/frame timing while a CLI executes; gestures/navigation and Stop remain responsive, with no invented benchmark pass.
- P8 (B8): Given streaming AI output, when Otto collapses or another feature opens, the run continues and reopening restores the same session and available output; only Stop/exit terminates owned work.
- P9 (B9,X7,C7): Given Assistant, provider/model/thinking selection can run only with proven tool-free admission; native tool/approval requests stop without side effects.
- P10 (B10,Q4): Given the user reads AI output, when music/timer updates or AI completes in background, the active feature and keyboard focus do not switch; 'Answer ready' is accessible without forced expansion.
- P11 (B11,X8,X9,Q3): Given a missing/unauthenticated/incompatible CLI or conflicting hotkey, the user sees the specific unavailable state and recovery action; no request or capture is silently executed.
- P12 (X10): Given an interrupted session followed by restart, Otto reports recovered state only if it actually exists; otherwise it labels the session interrupted/unknown and offers a fresh request.
- P13 (Q6): Given a question during another app task, the user can ask, read/copy/follow up on the answer, dismiss Otto, and return to the same task without switching to a standalone AI interface.

- P14 (B12,X11): Given active messages, formatted Markdown, code, and math remain readable during streaming without executing HTML; code and answer copy operate on those same messages.
- P15 (B13,X7,X12,C7): Coding runs scoped inspect/edit/test only under verifiable grants; denied, unsupported or cancelled effects never execute; recovery is visible.
- P16 (B14,X13,C8): Switching a runtime/model after a turn preserves Otto conversation/history and either reconstructs bounded saved context or reports native resume unavailable, without fabricating continuity.

## Assumptions
- A1 [non-blocking]: Codex is the initial supported provider; specific capabilities of Pi and Agy will be checked against installed versions.
- A2 [non-blocking]: Hard performance budgets are deliberately undefined until Windows idle/active measurements exist.
- A3 [non-blocking]: Screenshot defaults to the last focused external window; full-screen capture requires an explicit alternative selection. Revisit when implementing B4 if source selection is inadequate.
- A4 [non-blocking]: Current Assistant is tool-free; no existing CLI is presumed safe for Coding until actual workspace/approval/isolation semantics satisfy C7/P15.
- A5 [non-blocking]: Otto owns local text conversation history; provider thread IDs, credentials, and screenshots are not persisted. Reopen reconstructs context from the local transcript.
- A6 [non-blocking]: Coding is a future target, not implemented. Cross-runtime continuation now closes the old provider transport and retains Otto text history; native runtime, release and persistence integration remain unverified until Windows CI/acceptance. First Coding adapter must pass C7/P15 before activation.
