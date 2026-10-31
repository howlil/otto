---
colors: {surface: "#151515", text: "#FAFAFA", muted: "#A3A3A3", accent: "#C9B5FF"}
typography: {body: {family: "Segoe UI", size: "14px"}}
spacing: {unit: "4px"}
radius: {island: "9999px"}
motion: {profile: "spring", reduced: "respect system preference"}
---
# Design — Otto

## Direction
Product: persistent desktop notch for contextual CLI assistance.
Character: quiet, precise, expressive.
World: an unobtrusive instrument attached to the workspace edge.
Moments: a short state transition reveals a real streaming AI response.
Signature: a pair of robot eyes only on idle surfaces.

## Guardrails
Dark opaque pill, transparent external window area; low visual noise, no ornamental gradients.
UIArc is reference only. Source-of-truth tokens: `src/style.css`.
Do not treat browser animation alone as proof of native Windows morphing/frame pacing.

## State and Patterns
U1 idle (static scaffold); U2 compact activity; U3 expanded agent; U4 settings (future).
M1 hover U1→U2; M2 select/activate U2→U3; M3 dismiss U3→U1; M4 two-finger horizontal navigation.
ST1 appearance | UI local; ST2 window placement | Rust; ST3 agent lifecycle | Rust.
V1 idle, V2 running, V3 complete, V4 provider missing/retry, V5 capture denied, V6 media unavailable.
N1 real provider image capability before image submission. No fake provider states.

## Accessibility
Keyboard alternatives for hover/gesture, visible focus, announced errors, prefers-reduced-motion compliance. Ensure transparent padding does not steal unnecessary pointer events in a final implementation.
