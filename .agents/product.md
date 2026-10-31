# Product — Otto

## Problem
Actor / acceptor: Windows desktop user / owner. Trigger: needing help without switching from the current app.
J1: When working across desktop applications, I want contextual assistance and lightweight status without switching to a full-size tool, so I can stay focused on my work.

## Behavior
- B1: Otto remains visible as a small robot-eye/status notch in idle mode.
- B2: Hover expands; two-finger horizontal gestures or accessible controls change features; expansion can be dismissed.
- B3: User chooses Codex, Agy, Pi or OpenCode CLI, chats, receives incremental answers, follows up, or cancels.
- B4: On an explicit configured hotkey, capture screen silently, send image through a capable selected CLI and show analysis.
- B5: Music has compact/expanded transport and lyrics only if available.
- B6: Pomodoro supports configurable focus/break durations, pause, resume and reset.
- B7: Floating/top-attached notch with fluid morphing.
- X1 (B3): Missing/failed CLI -> explain, preserve input, allow retry or switching provider.
- X2 (B4): Capture denied or image unsupported -> explain; send no image.
- X3 (B5): Missing session or lyrics -> truthful unavailable state.
- X4 (B3): Cancellation/close -> stop owned child work and suppress stale output.
- X5 (B1,B7): Capture exclusion fails in unsupported screen recorders -> never promise universal invisibility.

## Constraints
- C1: Windows 11, Tauri 2, React, Vite, Rust, Tailwind CSS.
- C2: Use installed CLI and existing auth; no custom hosted model gateway/server.
- C3: Low idle CPU/RAM; nonblocking input and animation.
- C4: Always-on-top and capture exclusion are best effort, not universal guarantees.
- C5: Dark compact UI; UIArc used as visual reference, not a runtime dependency.
- C6: No automatic capture; user must initiate every screenshot.
- Q1: Profile idle memory/CPU and frame time on Windows before fixing numeric budgets.
- Q2: UI remains responsive during CLI execution.
- Q3: Recoverable errors for unsupported external capability.

## Scope
Product: B1–B7. Current scaffold only implements a static idle notch and Tauri window configuration. No simulated AI, music, screenshot, hover expansion, gestures, timer or moving placement.
First functional slice after scaffold: Codex prompt -> stream -> cancel -> reply inside Otto, end to end.
Out: cloud backend, database, telemetry server, auto-updater, cross-platform parity, speculative plugin architecture.

## Proof
- P1 (B1,B7,X5): Windows window is shown at top, with tested native capture exclusion limits reported.
- P2 (B2): Hover, navigation, gesture and dismissal produce reachable UI states, keyboard alternative exists.
- P3 (B3,X1,X4): Real CLI output streams; missing CLI/cancel recover; no orphan child process.
- P4 (B4,X2): Only explicit hotkey sends a real image; denied input never sends.
- P5 (B5,X3): Media controls and unavailable states truthfully reflect OS capabilities.
- P6 (B6): Timer controls preserve configured durations and elapsed time accurately.
- P7 (Q1,Q2,Q3): Windows sampling reports resource/frame responsiveness and recoverability.

## Assumptions
A1 [non-blocking]: Codex is first provider; other CLI protocol versions need validation.
A2 [non-blocking]: Performance budgets to be set from measurements, not fabricated.
A3 [non-blocking]: Screenshot monitor selection is deferred until B4 implementation.
