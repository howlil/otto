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
- B16: Horizontal touchpad swipe over Otto cycles Agent → Music → Pomodoro → Agent, preserving Compact/Preview/Pinned and background work. Home enters Agent forward or Pomodoro backward; settings/dialogs and OS-event capsules do not navigate. Vertical scroll, editing, code/table horizontal scrolling and pinch retain their normal behavior. Home controls and local Alt+Left/Right outside editors remain alternatives. WebView horizontal wheel input cannot prove finger count.
- B17: A global shortcut (default Ctrl+Alt+O, session-configurable) toggles the current module between Compact and pinned Expanded; Preview also toggles to Compact. It never hides the native window, exits, switches modules or cancels Agent/media/timer work. Collapse suppresses hover reopening until pointer leave. Global Settings exposes Expand on hover, Keep expanded and the shortcut under Interaction; hover timing and motion-profile controls are removed, while system reduced motion remains honored.
- B18: On Windows, the user may opt into Otto Dock mode from Global Settings → System. Otto asks Windows to auto-hide the taskbar, retains the pre-Otto taskbar state, restores it when disabled or Otto exits, and reports a recoverable error when the native state cannot be changed. This changes taskbar visibility as a reversible Windows setting; it does not manipulate individual Explorer buttons or claim literal taskbar transparency.
- B3: User chooses an installed Codex, Pi, Agy or OpenCode runtime and supported model/thinking, asks and follows up with streaming output and Stop; the selected runtime does not own Otto conversation identity.
- B4: An explicit camera action or configured hotkey intentionally captures the last focused non-Otto window without flash/selection UI, sends that image to a selected CLI with image support, and shows the analysis; full-screen capture is an explicit alternative.
- B5: Music Compact shows circular artwork, song/artist, and playback-linked activity spectrum; Expanded adds playback details/actions. The spectrum stops when playback stops; opening Lyrics automatically looks up source-backed lyrics without a separate Enable step. Lyrics/Player navigation is icon-only with accessible names; System media and inline LRCLIB/metadata-sharing labels are omitted. No lookup starts at launch, in Player, or after leaving Lyrics; missing, ambiguous, instrumental and unsynced results remain truthful.
- B6: Pomodoro Compact shows remaining time, phase and a primary control, with no progress line/timeline/percentage or ring; Expanded enables focus/short/long-break durations and phase selection, start/pause/resume/reset, with restrained state-change and completion motion and no progress bar or ring.
- B19: Mac-native sizing is Otto's only visual sizing system, using measured Mac camera geometry when available and approximate reference proportions otherwise. Remove the legacy Default sizing option without resetting other preferences, chats, music or timers. Shell corners follow notch geometry rather than pill rounding; attached retains a flat top with concave shoulders and rounded bottom corners. Module composition, navigation and behavior remain shared and unchanged.
- B7: User selects floating or top-attached placement; the capsule morphs into a rounded Expanded card. Attached uses curved shoulders connected to the screen edge; both placements preserve interaction without trapping or obscuring unrelated desktop actions. Otto requests an untitled native tool window to reduce Window source-picker listings where capture backends filter untitled or tool windows.
- B8: Collapsing Otto, switching feature, or returning focus to another app does not cancel an active AI request; reopening reveals ongoing output or its completed answer. Explicit Stop cancels; exiting Otto ends owned active work.
- B9: Assistant Mode answers open-ended domain, learning, logic and code questions, with model/thinking selection and no model tool, command, file-write or approval effects; no special learning/quiz engine.
- B10: Background AI, music, or timer updates never switch the active feature or seize keyboard focus; completed AI work appears as a quiet 'Answer ready' status that can be opened on demand.
- B11: Provider setup exposes whether the CLI is ready, needs authentication/setup, or lacks a required capability; user can recover or select another provider without losing a draft.
- B12: Streaming answers render Markdown, code and math safely, support copying, and never execute model-supplied HTML.
- B13: Coding Mode explicitly selects workspace and runtime; inspecting, editing and testing are allowed only after capability/scope validation, with approval before effects where required. Unsupported isolation/approval disables affected actions.
- B14: Otto-owned conversation and history survive runtime/model switching between turns; when a native session cannot resume, reconstruct only bounded saved transcript context and label the limitation.
- B15: Otto may surface a transient Compact-only OS event capsule for volume, display brightness, Wi-Fi, Bluetooth/peripheral and battery/power changes. It shows only confirmed OS state, never expands, is not a navigation destination, and never takes focus or changes the active feature. It auto-dismisses to the previous Compact presentation. Events observed while Otto is Expanded or an AI run is active are dropped, not queued. Observation runs only while the app runs, is never persisted, and can be disabled.

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
- X14 (B15): An OS event observer is unavailable, blocked or unsupported → no capsule; "Disconnected/Off" is never rendered from a failed read.
- X15 (B15,B10,Q4): An OS event arrives while Otto is Expanded or an AI run is active → drop it silently; no deferred stale capsule, no focus or active-feature change.
- X16 (B15): Untrusted native text (device or profile name) is sanitized or omitted; it is never executed or logged.
- X17 (B7,Q4): Attached placement cannot be applied or its native hit region is rejected → keep the reported placement, never paint an unconfirmed silhouette, and offer retry or the other placement.
- X18 (B18,Q4): Windows rejects or loses the taskbar state change → do not persist an unconfirmed Otto Dock state, preserve the last confirmed state, and offer retry without touching individual taskbar buttons.


## Constraints
- C1: Windows 11 first; Tauri 2 + React + Vite + Rust + Tailwind CSS, Bun for JS package management/scripts.
- C2: Use locally installed Codex, Pi, Agy and OpenCode CLIs with their existing authentication; no separate AI API, hosted model gateway, or backend service.
- C3: Low idle resource usage, responsive interface, and recoverable external dependencies.
- C4: Always-on-top and capture exclusion are best effort; secure desktop, fullscreen modes, and third-party capture paths may behave differently.
- C5: Compact dark UI; UIArc is a visual reference, not a runtime dependency.
- C6: Capture and image transmission happen only after an explicit configured user action; do not perform periodic/automatic screenshots.
- C7: Assistant launch requires proven tool-disabled behavior. Coding actions require verifiable workspace scope and pre-effect runtime/OS permission enforcement; prompt instructions, read-only labels, Job Objects or post-hoc events are insufficient.
- C8: Otto owns conversation identity, execution lifecycle, prepared context and mode policy; external CLI/runtime and model capabilities are negotiated, not imported into core business logic.
- C9: Music text is limited to sourced song lyrics through LRCLIB. Captions, audio capture and speech/transcription engines are out of scope.
- Q1: Measure Windows idle CPU/memory and interaction frame pacing on a representative machine; numeric thresholds remain undefined pending baseline (A2).
- Q2: During CLI execution, users can still navigate, collapse, reopen, and stop without UI freezing; record interaction responsiveness during a real run.
- Q3: Invalid/unsupported provider, media, hotkey, or capture capability leaves a clear recoverable state, not a misleading success indication.
- Q4: Background activity must not unexpectedly change active view or keyboard focus.
- Q5: Screen content must not be submitted without an explicit user capture action; the user can identify the intended capture target.
- Q6: User can obtain an answer and return to the original task without opening a separate AI interface.
- Q7: OS event observation adds no idle polling beyond the documented brightness interval and battery reconcile interval; measured with the Q1 harness.

## Scope
- Agent scope: Assistant (current) uses installed CLIs for streaming chat, reasoning, model/thinking selection, safe Markdown, screenshot analysis, local history, Stop and collapse/reopen; Coding (future target, NOT implemented by this documentation PR) adds explicit workspace, authorized inspect/edit/test, tool activity and pre-effect approval. Codex/Pi image input remains capability-gated; Agy headless and OpenCode are text-only until verified otherwise. Agy remains unavailable when its actual handshake advertises executable tools; Otto never bypasses admission to make a provider appear ready. OpenCode uses an isolated chat profile and bounded transcript reconstruction between turns.
- Supporting product direction retained but not Agent completion prerequisites: configurable placement, media, Pomodoro, and optional idle information.
- Out: dedicated learning/quiz engine, multi-agent orchestration, dynamic plugin loader, universal feature parity or native-session migration, direct model API/cloud gateway, automatic screen surveillance, speculative database/services and multi-OS parity. Tool execution and workspace access remain out of Assistant and gated in future Coding.

## Proof
- P1 (B1,B7,X5): Given a supported Windows session, exactly one Otto host starts; duplicate and concurrent launches exit before native window/hotkey initialization, and the first instance keeps its active chat transport/history. The native tool-window style remains set; picker filtering and pixel exclusion require representative Windows acceptance.
- P2 (B2): Given any Compact module, hover reveals its Expanded preview without focus theft; click/keyboard activation pins the card; exiting/Escape restores Compact, and Expanded Home exposes all module entries without mandatory gesture navigation.
- P3 (B3,X1,X4): Given a ready CLI, asking produces a real partial/final answer and follow-up; a missing/failed CLI keeps the draft recoverable; explicit Stop/exit ends owned work without a stale answer.
- P4 (B4,X2,X6,Q5): Given a valid last-focused window and capable provider, only an intentional hotkey sends its image and returns analysis; denied, unsupported, missing or ambiguous targets send nothing and offer recovery.
- P5 (B5,X3): Given an active media session, Compact shows song/artist, circular cover and a spectrum only during playback; controls reflect observed state, and absent sessions/lyrics do not display fabricated data. Opening Lyrics searches automatically; closing/navigating away stops new lookups, old-track results cannot replace the current song, and plain lyrics never acquire fabricated timestamps.
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
- P17 (B15,X14,X15,X16,Q7): Given real Windows events, each class renders only confirmed state; no capsule appears while Otto is pinned or an AI run is active; event observation stays within the measured idle baseline.
- P18 (B7,X17,Q4): Given either placement, the notch keeps the same content and actions; attached sits flush to the monitor top edge with curved shoulders outside the native hit region, floating respects the top offset, and a rejected placement preserves the reported state with recovery. Pointer pass-through of the shoulder corners requires representative Windows acceptance.

- P19 (B16,B8,B10): One horizontal gesture switches one module despite inertia; vertical/pinch/editor/code input does not navigate, settings/dialogs stay put, and existing drafts/runs/timers survive navigation.
- P20 (B17,B8,B10): Repeated shortcut activation alternates the same module between Compact and pinned Expanded, collapses Preview, preserves drafts/background work, never hides the window, and exposes recoverable shortcut conflicts. Global Settings has no generic Otto hide, hover-timing or motion-profile controls.
- P21 (B18,X18,C4): Given a Windows session, enabling Otto Dock mode applies confirmed taskbar auto-hide while preserving other taskbar state, disabling or exiting restores the pre-Otto state, and a rejected native change remains recoverable without persisting false success. Non-Windows builds leave the taskbar untouched.

- P22 (B19,B2,B7): Saved legacy sizing selections are ignored while other preferences survive; every module uses the same native sizing resolver and existing component tree. Compact corners are 13px and Expanded corners 18px, with zero top radius only when attached. Native window/shell geometry stays coherent in both placements; measured hardware and Mac native input still require real-Mac acceptance.

## Assumptions
- A1 [non-blocking]: Codex is the initial supported provider; specific capabilities of Pi and Agy will be checked against installed versions.
- A2 [non-blocking]: Hard performance budgets are deliberately undefined until Windows idle/active measurements exist.
- A3 [non-blocking]: Screenshot defaults to the last focused external window; full-screen capture requires an explicit alternative selection. Revisit when implementing B4 if source selection is inadequate.
- A4 [non-blocking]: Current Assistant is tool-free; no existing CLI is presumed safe for Coding until actual workspace/approval/isolation semantics satisfy C7/P15.
- A5 [non-blocking]: Otto owns local text conversation history; provider thread IDs, credentials, and screenshots are not persisted. Reopen reconstructs context from the local transcript.
- A6 [non-blocking]: Coding is a future target, not implemented. Cross-runtime continuation now closes the old provider transport and retains Otto text history; native runtime, release and persistence integration remain unverified until Windows CI/acceptance. First Coding adapter must pass C7/P15 before activation.
- A7 [non-blocking]: OS Events shows Wi-Fi and Bluetooth connection state without SSID, MAC address or serial numbers; device names are shown only for peripherals that report one. The event capsule defaults ON and has one master toggle; per-class toggles wait for observed noise.
