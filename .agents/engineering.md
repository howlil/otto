# Engineering — Otto

## System
Windows-first Tauri 2 modular monolith for Otto as a **Personal AI Assistant & Learning Mentor**. Dependency direction: K1 React UI → K2 Tauri host/IPC adapter → K3 Agent run/conversation core ← K4 statically registered CLI adapters; K5 owns platform-specific native effects, including Windows capture/region-snip/placement and macOS display monitoring. K3 owns Otto run, conversation, learning-mode/profile prompt framing, host-permission mediation, single-slot follow-up queue, and event ordering; K4 owns CLI protocols and process lifecycles across 19 compiled local CLI engines (Codex, Pi, OpenCode, Claude Code, and 15 ACP CLIs) while preserving each engine's native configuration. C2 excludes direct model APIs/cloud gateway and Ollama HTTP backends. Otto adds no coding workspace (`cwd`) picker, file-edit executor, or shell executor, and does not inject custom tool-policy/sandbox flags; prompts frame non-destructive personal assistance, and incoming CLI permission requests are mediated inline via an explicit user choice (never auto-approved). Dynamic plugin loading, cross-session memory DB, study LMS, multi-agent orchestration, a new crate/database, and multi-OS parity remain out of scope. Local text history (up to 100 messages/conversation), CLI streaming, and explicit staged-first capture remain under their contracts; real Windows provider-auth, region snip, dual hotkeys, capture, and OS behavior still need acceptance.

## Structure

### Current map
- The frontend entry is src/main.tsx → src/app/index.ts → src/app/App.tsx. AppView, ShellContent, ShellSurfaces, and ShellCompactSurface live together under app/.
- features/agent is organized by state and user-facing responsibility: model, hooks, capture, capsule, conversation, history, settings, and transcript. Its index.ts is the cross-feature facade; AppView consumes explicit exported view models.
- features/shell groups model, hooks, surface-sync, and UI/settings. Geometry queueing and rendered-region synchronization stay in surface-sync; shell transitions and preference state stay in model/hooks.
- Tauri DTOs and commands are split under platform/tauri/ by Agent, capture, overlay, shell, shortcut, and runtime concerns. platform/updates.ts owns the updater bridge.
- Rust lib.rs is the composition root. ipc/ owns Tauri command adapters, Channel subscriptions, and capture dispatch; agent/runtime/ owns run, selection, readiness, session, recovery, and history coordination without Tauri Channel scheduling.
- agent/conversation/ owns ConversationOwner and HistoryStore. agent/providers/ owns the typed catalog/registry, shared process and support code, and per-provider protocol folders for Codex, Pi, Agy, OpenCode, and Claude Code.
- The five adapters are compiled and exhaustively dispatched. The catalog checks installed commands on each refresh from Otto's process PATH; readiness is probed separately. A PATH change made by an external installer after Otto starts requires an app restart or an explicit future environment-refresh capability.
- Cross-platform notch sizing and silhouette geometry live in shell/; native effects live in platform/windows/ and platform/macos/. Windows capture is split into target selection, image lifecycle, accessibility selection, and hotkey dispatch.
- Frontend tests are grouped under agent/, shell/, shared/, release/, and e2e/. Large Agent runtime tests live under agent/tests/; provider tests stay with their adapter or in providers/tests/.

### Current and target folder tree
Keep one modular monolith. This tree records the ownership implemented for the Agent and Shell refactor; add files to the owning submodule when its behavior needs them.

    src/
      main.tsx
      app/
        index.ts
        App.tsx
        AppView.tsx
        ShellContent.tsx
        ShellSurfaces.tsx
        ShellCompactSurface.tsx
      features/
        agent/
          index.ts
          model/
            draft-state.ts
            readiness-probe.ts
            status.ts
            surface.ts
            view-model.ts
          hooks/
            useAgent.ts
            useAgentConnection.ts
            useAgentReadiness.ts
            useAgentRequests.ts
            useAgentRuntimeActions.ts
          capsule/
            AgentCapsule.tsx
          capture/
            useCaptureShortcut.ts
            useCaptureSource.ts
            useAgentCapture.ts
            AgentCaptureSettings.tsx
          conversation/
            AgentPanel.tsx
            AgentHeader.tsx
            AgentHeaderControls.tsx
            AgentComposer.tsx
            AgentControls.tsx
            AgentErrorNotice.tsx
          history/
            agent-history.ts
            history-model.ts
            useAgentHistory.ts
            History.tsx
            HistoryRows.tsx
            HistoryRow.tsx
            HistoryDeleteAllPrompt.tsx
          transcript/
            AgentTranscript.tsx
            TranscriptMessages.tsx
            TranscriptOutcome.tsx
            useTranscriptViewport.ts
            content/
              MessageContent.tsx
              DeferredMessageContent.tsx
              CodeBlock.tsx
              CopyAnswerButton.tsx
              useCopyFeedback.ts
              markdown-highlight.ts
          settings/
            AgentSettings.tsx
            AgentSettingsNavigation.tsx
            AgentSettingsDetails.tsx
            AgentSettingsSections.tsx
            ProviderChoice.tsx
            ModelUsageSettings.tsx
            ModelContextUsage.tsx
        shell/
          index.ts
          model/
            preferences.ts
            surface.ts
            placement.ts
            motion.ts
            view-model.ts
          hooks/
            useNotchShell.ts
            useShellPreferences.ts
            useShellInteraction.ts
            useShellHover.ts
            useShellFocus.ts
            useShellPlacement.ts
            useShellShortcut.ts
            useShortcutControls.ts
            useAppUpdate.ts
          surface-sync/
            index.ts
            useNotchSurfaceSync.ts
            useRenderedRegion.ts
            useNotchHost.ts
            geometry-queue.ts
            layout.ts
          ui/
            ShellFrame.tsx
            SurfaceError.tsx
            settings/
              GlobalSettings.tsx
              InteractionSettings.tsx
              PlacementSettings.tsx
              ShortcutSettings.tsx
              SystemSettings.tsx
              UpdateSettings.tsx
      platform/
        tauri/
          index.ts
          runtime.ts
          agent.ts
          capture.ts
          overlay.ts
          shell.ts
          shell-shortcut.ts
        updates.ts
      shared/
        ui/
          index.ts
          Button.tsx
          ActiveIndicatorGroup.tsx
          Field.tsx
          FieldControls.tsx
          FormField.tsx
          Icon.tsx
          OttoLogo.tsx
          SettingsSection.tsx
          Status.tsx
          Text.tsx
          TransitionContent.tsx
          Eyes.tsx
          a11y.tsx
      assets/
        providers/
      style.css
      vite-env.d.ts

    src-tauri/src/
      main.rs
      lib.rs
      ipc/
        mod.rs
        agent.rs
        agent_capture.rs
        app.rs
        notch.rs
        overlay.rs
        shell_shortcut.rs
      agent/
        mod.rs
        model.rs
        error.rs
        events.rs
        tests.rs
        tests/
          runtime.rs
          measurements.rs
        conversation/
          mod.rs
          owner.rs
          history.rs
        runtime/
          mod.rs
          run.rs
          selection.rs
          readiness.rs
          readiness_probe.rs
          capture.rs
          session.rs
          history_ops.rs
          recovery.rs
        providers/
          mod.rs
          catalog.rs
          registry.rs
          process/
            mod.rs
            job.rs
            transport.rs
            framing.rs
          support/
            mod.rs
            authentication.rs
            capture_image.rs
          codex/
            mod.rs
            requests.rs
            readiness.rs
            rpc.rs
            events.rs
            turn.rs
          pi/
            mod.rs
            readiness.rs
            rpc.rs
            events.rs
            cancellation.rs
            turn.rs
          acp/
            mod.rs
            readiness.rs
            client.rs
            admission.rs
            turn.rs
          opencode/
            mod.rs
            readiness.rs
            turn.rs
          claude/
            mod.rs
            readiness.rs
            stream.rs
            turn.rs
          tests/
            mod.rs
            acceptance.rs
      shell/
        mod.rs
        notch.rs
        sizing.rs
        geometry.rs
      platform/
        mod.rs
        windows/
          mod.rs
          capture/
            mod.rs
            target.rs
            image.rs
            hotkey.rs
            tests.rs
          overlay.rs
          region.rs
          shell_shortcut.rs
          single_instance.rs
        macos/
          mod.rs
          display.rs

    tests/
      agent/
        agent-*.test.*
        capture-state.test.mjs
        draft-state.test.mjs
        deferred-message-content.test.tsx
        message-markdown.test.mjs
        readiness-probe.test.mjs
      shell/
        shell-*.test.*
        surface-routing.test.mjs
        placement-interaction.test.tsx
        notch-sizing.test.tsx
        global-settings.test.tsx
      shared/
        shared-field.test.tsx
        otto-logo.test.tsx
      release/
        release-*.test.mjs
        preflight.test.mjs
      e2e/
        visual-capture.test.mjs
        transitions-native.mjs
        shell-native.ps1
        preflight.mjs
        p8-native.mjs
        codex-fixture.test.mjs
        codex-fixture.mjs
        bin/
          codex.cmd
      setup/
        dom.ts

### Boundaries and design patterns
- Composition roots: app/App.tsx composes React feature facades; src-tauri/src/lib.rs constructs Tauri state and registers IPC. features/agent/hooks/useAgent.ts and features/shell/hooks/useNotchShell.ts remain feature facades, not new state stores.
- Ports and adapters plus an Adapter/Strategy registry: AgentRuntime accepts provider-neutral requests/events; exhaustive typed dispatch selects one compiled CLI adapter to translate its native protocol. The catalog discovers installed supported CLIs from PATH at refresh time. Claude Code is a first-class adapter alongside Codex, Pi, Agy, and OpenCode. Adding a new CLI requires its protocol adapter; PATH discovery alone cannot infer a CLI protocol.
- Provider contract ownership: agent/model.rs owns the closed ProviderId used by run state; providers/catalog.rs owns descriptors, supported-platform status, and installed-command detection; providers/registry.rs owns exhaustive adapter dispatch. One refresh recomputes installed state from Otto's current PATH, without auto-selecting a provider. An installer changing PATH after Otto starts does not update the process environment; same-session discovery would need an explicit environment refresh or app restart.
- State reducer: Rust owns run, ordered events, conversation identity, and persisted history. A single reducer accepts only the active run and one terminal outcome; React owns drafts and transient view state, while provider session identity stays inside the adapter.
- Process supervisor and scoped lifetimes: shared process code owns argument-array launches, child-tree lifetime, bounded frames, cancellation, timeouts, and cleanup. The Windows Job Object stays inside this process boundary; no Win32 handle crosses into K3. Capture files remain ephemeral and are removed by their owner.
- Typed Tauri boundary: platform/tauri/agent.ts owns Agent DTOs, commands, and Channel subscription; ipc/agent.rs translates those commands to AgentRuntime. The runtime must not import tauri::ipc::Channel or Tauri task scheduling. Keep host scheduling in K2 or use the existing Tokio runtime without a Tauri dependency.
- Conversation persistence: ConversationOwner and HistoryStore stay the single writer for bounded local text history. Do not add a generic Repository layer or mirror authoritative run/history state into React.
- Public module entries: feature index.ts and Rust mod.rs files expose stable APIs and keep implementation private. They should contain declarations/re-exports only; provider protocol parsing stays inside that provider folder.
- Provider compatibility is a hard invariant: preserve each CLI's native configuration, tools, permission behavior, and session semantics. Do not add deny-lists, approval overrides, sandbox flags, tool dispatch, or a common tool-policy layer. Otto has no edit/shell executor. The CLI working directory is process context, not an Otto workspace or file API; native CLI tools can still act according to their own permissions.
- The Rust ProviderId and TypeScript AgentProvider union are one cross-language wire contract. Keep them exhaustively aligned with a contract check; generate types only if the existing build can own generation without adding unnecessary dependencies.
- Never create empty folders or a folder per component. Group files by state owner, protocol, user surface, or native effect. Split large adapters only along real responsibilities such as readiness/catalog, protocol I/O, event translation, and turn lifecycle. Keep provider-specific behavior separate where the protocols differ.
- Keep cross-feature imports behind public feature indexes. Render-only components receive props and callbacks; Tauri commands stay in the platform bridge. AppView should consume an explicit exported view model instead of ReturnType of internal hooks.

### Completed structural moves
- App composition moved under src/app/; app/index.ts now exports the composition entry and the shell surfaces.
- Agent, capture, overlay, shell, shortcut, and runtime Tauri APIs moved under platform/tauri/. The capture-now feature hook composes into useAgent without making the Agent facade import the bridge.
- Tauri Channel fan-out moved to ipc/agent.rs and AppHandle capture dispatch moved to ipc/agent_capture.rs. Runtime run/recovery ownership stays under agent/runtime/.
- Codex request construction moved to providers/codex/requests.rs. Request builders forward model/effort and captured-image inputs without setting tool, sandbox, or approval policy.
- Notch sizing and pure geometry moved under shell/; Win32 region work and capture lifecycle moved under platform/windows/; macOS display monitoring moved under platform/macos/.
- Agent conversation/history and provider implementations moved into vertical submodules. Existing provider protocols, native permission behavior, process arguments, and serialized IPC contracts remain owned by their existing adapters and boundary types.
- Frontend tests moved into behavior-oriented folders; large Rust Agent tests moved under agent/tests/ and Windows capture tests under platform/windows/capture/tests.rs.

### Folder and change rules
- K1 (frontend): App composes feature facades; render-only components do not call the Tauri transport. The Agent owns UI request/draft presentation; Shell owns Compact/Preview/Pinned and settings navigation.
- K2 (host/IPC): lib.rs is the composition root; ipc/ validates command inputs, owns Tauri Channels, and delegates. It does not parse CLI protocols or own Agent policy. shell/ owns cross-platform notch geometry; platform/ owns native OS effects.
- K3 (Agent core): agent/ owns run/session state, event ordering, typed provider identity, and conversation coordination. Conversation storage is a separate submodule. No Tauri Channel, Win32 handle, provider protocol payload, or Otto tool dispatcher enters the core.
- K4 (CLI adapters): providers/ owns the compiled support catalog, PATH installation checks, readiness, capabilities, native process lifetime, and each CLI protocol. Provider-native tool and permission behavior remains external to Otto.
- K5 (native platform): platform/windows and platform/macos own window, capture, region, display, shortcut, and single-instance APIs and resource cleanup. K4 owns provider child-process lifetime, with the Windows Job Object encapsulated in that boundary. Capture does not import AgentRuntime or submit model turns; IPC coordinates the request.
- Dependency direction: app → features → platform/tauri → ipc → AgentRuntime → provider registry/adapters → CLI. K2 mediates native commands and callbacks between AgentRuntime and platform/windows or platform/macos; no native module calls AgentRuntime directly. Cross-feature imports use feature index.ts. K2 pushes ordered snapshots back to K1; the UI cannot authorize native effects by rendering an affordance.
- Preserve current runtime behavior while moving files. Do not add global stores, dynamic plugin loading, new crates, new databases, speculative services, or a full rewrite. No tool restriction is injected into provider CLIs.

## Responsibilities
- R1 (B1,B2,B10,B19,B21,B22,B23): present Agent Compact/Preview/Pinned state, warm non-technical Personal Assistant UI, curated Learning Mode pill & `/slash` triggers, header Engine/Model/Effort popover, staged capture attachments & contextual Quick Actions, collapsible Thinking preview, inline permission choice card, learning follow-up chips, universal Insert action, settings navigation (including Profile & Learning Style), drafts, unobtrusive completion and keyboard/focus intent.
- R2 (B3,B8,B13,B23,B24,X1,X4,X10,X20,X21): own provider-neutral run/turn lifecycle, event ordering, Stop (preserving already-streamed partial text as Stopped), Retry/Regenerate, Edit & re-run, single-slot follow-up queue, bounded Thinking/Reasoning capture, inline host-permission decision mediation (never auto-approved), and recovery; delegate conversation persistence to R8 and native protocol/session behavior to K4.
- R3 (B4,B20,B22,X2,X6,X8,X18,X19): explicitly triggered capture (Region Snip, window, scrolling window, full screen, selected text), independent Selected Text and Visual Capture hotkey registration, external-window target validation, pasted/dropped image validation, staged ephemeral attachment lifecycle with Drop cleanup, and validated caret insertion.
- R6 (B1,B2,B7,B10,X5): own native window position, pointer region, always-on-top, focus, capture affinity and best-effort suppression from supported capture source pickers via Windows tool-window style.
- R7 (B9,B11,B13,B24,X7,X9,X12,X21): own 19-engine catalog, live PATH refresh, readiness/probe optimization, persistent Codex/OpenCode multi-turn session reuse, Claude/OpenCode model/thinking/image parity, and protocol-level host-permission pause/response; never rewrite native CLI configuration or auto-approve provider actions.
- R8 (B3,B14,B23,X10,X13,X20): own Otto conversation identity, transcript (up to 100 messages/conversation), local history with full-text search & Markdown export, independent of runtime; distinguish actual native resume from saved-context reconstruction.
- R9 (B4,B9,B20,B21,B22,X2,X6,X19): compose the turn prompt in K3 from curated Learning Mode framing, static Profile & Learning Style, user text, staged selected text (untrusted ephemeral), and staged visual capture/pasted image (ephemeral); the CLI default working directory stays `%USERPROFILE%` (no workspace/folder picker). Windows capture/snip implementation belongs to K5, not AI lifecycle.

## State
- S13 (B17): a distinct Win32 shortcut thread owns registration and session-only replacement and emits `otto-toggle-expanded`; the existing Shell S1 owner toggles Compact/pinned, with Preview collapsing via dismiss and its hover-rearm guard. Native visibility, tray and capture policies are not involved. React keeps one app-lifetime listener with a latest-callback ref; shortcut conflicts preserve the previous registration when possible.
- S1: selected Agent/settings surface and exclusive Compact/Preview/Pinned mode | owner Shell hook (R1/React) | background updates cannot select a different surface or take keyboard focus; hover timers may request Preview but never pin without explicit activation. Stored clickOutside controls only pinned blur collapse (inverse Keep Expanded UI), not Preview or Escape. Shell preferences have one React writer and validated localStorage mirror; native bounds are owned by S2.
- S2: placement, native bounds, focus policy and capture affinity | owner R6 (Rust) | no implicit activation on hover. Win32 owns actual display affinity and reports current state via IPC readback; exclusion starts ON and only confirmed changes update saved React preference. Tool-window picker suppression remains a separate best-effort mechanism. Placement is also observed, not assumed: host configuration returns a revision and capacity; only an acknowledged rendered-region write confirms `floating|attached` from native region/bounds readback, and the UI persists only that observed value.
- S3: run/turn state | owner R2 (Rust) | single authority, run_id/seq ordering, one terminal outcome and rejection of late events; UI Snapshot is a projection, not independent authority.
- S4: committed provider identity and accepted active-run model/thinking/capabilities | owner AgentRuntime snapshot (Rust) | the React provider value mirrors the latest snapshot; Rust validates each submitted model/capability against readiness and locks changes during a run. The composer owns the next-request model/thinking draft until submission; Pi additionally mirrors its native RPC model selection in Rust. Never persist credentials or native session IDs.
- S9: Otto conversation ID/transcript/history | owner R8 (Rust) | bounded versioned JSON (up to 200 conversations, 100 messages/conversation), single writer, atomic replace/corruption recovery, full-text search & Markdown export; provenance per run; expand/migrate/contract compatibility; stopped partial answers preserved with `interrupted: true` and explicit Stopped status; limited reconstruction must not claim native resume.
- S10: provider-native session/child process | owner K4 adapter | ephemeral, owned per runtime, persistent across turns where supported (Codex, Pi, ACP, OpenCode `--session`, Claude `--resume`), cancelled/closed on Stop/exit, never portable conversation authority.
- S11: provider-native tools and permissions | owner external CLI | Otto does not store or rewrite CLI settings; an incoming host permission request pauses the turn and awaits explicit K3 decision (`Decline & continue` or `Allow once`), never auto-approved.
- S15: supported-engine catalog and installed state | owner compiled adapter registry (Rust), projected by Agent readiness UI | 19 compiled adapters (Codex, Pi, OpenCode, Claude Code + 15 ACP CLIs) form the supported set; catalog refresh checks PATH and supports an explicit live Windows environment PATH refresh (reading User/System PATH from Windows registry without mutating global OS state) so newly installed CLIs appear without restarting Otto. There is no background PATH watcher or arbitrary CLI/plugin discovery.
- S5: target window, dual capture hotkeys, staged capture/pasted attachments and ephemeral image lifetime | owner R3 (Rust) | explicit invocation provenance, still-valid non-Otto target, no send on ambiguity/denial; staged image/selected-text attachments stay ephemeral in Rust (`CapturedImage` Drop cleanup on clear/submit/finish/error/cancel) and are never persisted in History. After a crash, startup may delete only named capture files aged >=24h when the owning PID is confirmed exited; unknown/active PIDs and unrelated files are preserved. Best effort, not secure erasure.
- S8: unsent chat draft, staged attachment preview metadata, next-request model/thinking selection, transient connectivity, capture settings and history UI operations | owner Agent hook (R1/React) | submitted drafts are correlated with accepted run IDs; provider selection is committed through Rust and mirrored from Snapshot; model/thinking remain a composer draft until accepted into a run, while Pi also requires a Rust-side native-session selection. History list/open/rename/delete/search/export use one feature-owned AgentHistoryController with an exclusive pending operation and stale-result protection. Rust S3/S4/S5/S9/S17, not UI state, authorize capability, capture, active-conversation reset, permission responses, and persistence. Unsent draft remains memory-only.
- S16 (B21,B22): active curated Learning Mode (`direct|mentor|simple|write|practice`), static Profile & Learning Style (preferred answer language, level/tone, bounded brief instructions), and capture Instant Auto-Send preference | owner R1/R9 (persisted validated local preference, sent explicitly on turn submission to K3 `prompt.rs`) | never treated as cross-session dynamic memory or system-tool escalation; bounded byte limits enforced in K3.
- S17 (B23,B24,X20,X21): pending host permission request (`request_id`, engine name, concise non-secret summary, awaiting oneshot response channel), bounded Thinking/Reasoning text per active turn, and single-slot queued follow-up | owner R2 (Rust `AgentRuntime`) | single authority; at most one pending permission request and one queued follow-up; Stop/Close/timeout resolves pending permission as explicit Decline/Cancel (never auto-approve) and returns any unstarted queued follow-up cleanly to UI draft on Stop/error.
- Concurrent writes: one active run owner serializes run transitions; independent background completions update their own data, never S1. UI events are observations, not independent authoritative copies.

## Contracts
- R1/R6 sizing: Mac Native is the only sizing path; host replies include display geometry source (`physical-notch|notchless|approximate`), logical camera/reference envelope and contentTop. `notch_sizing.rs` is the sole display-aware surface resolver; obsolete saved sizing selections are ignored and removed by the existing preference writer without changing other preferences or module owners. AppKit measures the NSWindow's current NSScreen on the main thread, checks API availability and valid symmetric auxiliary regions; a managed CoreGraphics display callback emits `otto-display-changed` after reconfiguration (including same-scale mode changes), unregisters on Exit and shares the existing serialized host refresh queue; no safe inset means notchless, never a physical-notch claim. Same-process IPC evolves together; no alternate legacy layout remains. CSS owns 13px Compact and 18px Expanded shell corners; reported radii keep the native silhouette synchronized without overriding descendant control radii.
- K1 -> K2: typed Tauri command `submit/stop/provider_status` (names illustrative until implemented), input validation and bounded payload; immediate outcome = accepted run_id or recoverable error. Rendering the UI cannot authorize OS side effects.
- K1 -> K2 app lifecycle: `app_quit` requests Agent Stop, ignores the no-active-run result, then exits through Tauri.
- K2 notch geometry: `notch_configure_host(client_id, placement, top_offset, position, width, height)` validates and configures a monitor-bounded stable host, using an optional saved floating position and the default centered placement otherwise, returning its revision, logical capacity, scale, placement and Rust-owned surface layouts. Ordinary surface navigation never resizes it. `notch_set_region(region)` carries hostRevision, monotonic sequence, physical body rectangle, radii and shoulder; core rejects previous-client host revisions and stale sequences and invalid or out-of-host geometry before Win32 application. Both placements retain a silhouette region; attached shoulders extend outside the body inside host capacity, not content padding. Startup stays hidden until the first verified region. Same-process IPC evolves together; there is no old grow/shrink fallback.
- K2 -> K3: validated provider/run request → R7 readiness and capability checks → accepted run. UI selection never changes provider-native tool or permission policy.
- K3 <-> K4 provider ports: a provider ID resolves through the compiled catalog to an external CLI adapter. Adapters expose typed readiness/capabilities and normalized ordered events keyed by `run_id` and sequence; native protocol, session, tools and permission rules stay with the CLI. No universal ANSI parsing or silent fallback.
- K3 -> K2 -> K1: core-owned ordered Agent events/snapshots carry `run_id` and sequence; K2 adapts them to Tauri Channels today. A future UI host consumes the same core projection without changing Agent logic. Sequence/run_id guards reject late, duplicate or stale output; Stop is idempotent and UI collapse neither stops nor detaches a run.
- Provider-native tool & host-permission flow (C7,B24): K3 composes each turn with non-destructive Personal Assistant / Learning Mode framing and static Profile & Learning Style without altering CLI flags or config files. K4 passes native settings through and streams normalized answer, bounded Thinking/Reasoning, usage, and non-technical activity events. If an engine emits an incoming host permission request, K4 suspends the turn and emits a `PermissionRequested` state to K3→K2→K1; K1 renders an inline "Decline & continue" / "Allow once" card and submits the explicit decision through K2→K3→K4. Auto-approval is forbidden (`G8`); Stop/timeout/dismiss always resolves as explicit Decline/Cancel.
- Staged Capture & Dual Hotkey contract (B22): K5 owns two independent global shortcut registrations (`selectedText` and `visualCapture`) plus a native transparent region-snip selection overlay that returns bounded physical coordinates or Escape cancellation without modifying the clipboard. Both hotkeys, composer camera selection, and `Ctrl+V`/drop image attachments stage ephemeral context into K3 (`S5`) and notify K1 to display removable attachment chips + contextual Quick Actions (or submit directly when the user explicitly opts into Instant Auto-Send). Unaccepted staged files drop cleanly on clear/new-chat/exit.
- Conversation & Turn Control contract (B23): K2 exposes typed commands for Retry/Regenerate, Edit-and-rerun (truncating/branching from the edited turn cleanly in K3/R8), single-slot follow-up Queue/Cancel, History full-text search, and Markdown export. `agent_insert_text` operates on any completed assistant message without gating on `selectedText` capture mode.
- K1 rich transcript boundary: the Agent transcript may load Markdown, KaTeX and code-highlighting resources on demand after the Agent surface or rich answer is needed. The boundary preserves inert HTML, safe links, code-copy behavior and math fallback; a failed optional load must not lose the transcript or alter R2 run state.
- K1 shared identity: `OttoLogo` supplies the Agent header mark and is not a button; the header gear is the single entry to Settings. Settings is composed in `app/SettingsSurface.tsx` from `features/agent` (Assistant, Capture) and `features/shell` (Behavior, Position, General) sections, with `SettingRow`/`SettingBlock`/`ShortcutRecorder` in `shared/ui`. `OttoLogoProvider` supplies a read-only shell-preference projection; it owns no state or persistence.
- K1 shared UI boundary: `shared/ui` exposes stateless controls through its public entry; individual control files may be split for ownership/readability, but the public API and token source remain stable. Splitting `Field.tsx` or `ShellContent.tsx` is a maintainability change, not a bundle optimization.
- K3 -> process boundary: K4 launches the selected executable with an argument array, inherits provider-native configuration, owns process-tree lifetime, and bounds untrusted I/O; the default working directory remains `%USERPROFILE%`. Windows suspended-start Job Object constrains process lifetime, not filesystem permissions or provider behavior.
- K3 -> K5: core-owned context/capture port carries validated explicit user intent; Windows returns capture result or recoverable error, cleans ephemeral resources, and must not directly call AgentRuntime (existing D6).
- Compatibility: same-process IPC evolves together; durable history expands/migrates before old format is retired and retains rollback readability; runtime switching never implies native-session portability.
- DEP1: Windows WebView2 | reuse OS runtime | missing runtime prevents UI, show installer/runtime remediation | availability bound: OS installation | exit cost: switching Tauri UI stack.
- DEP2: Codex/Pi/Agy/OpenCode/Claude Code executables | reuse user install/auth | absent, version drift, auth expiry, or unsupported capability = explicit recoverable state | availability bound: local CLI/provider service | exit cost: per-provider adapter update.
- DEP3: Windows window/capture APIs | reuse OS | unsupported or blocked = capability-specific degradation | availability bound: Windows/version/recorder | exit cost: native integration rewrite.
- Provider-side conversations/logs and model transmission follow each CLI/provider policy; Otto cannot promise their deletion.

## Flows
- Existing bootstrap (B1): process launch -> K5 Windows per-session named mutex (duplicate exits before Tauri initialization; error fails closed) -> K2/K5 frameless WebView -> K1 idle. The handle remains open for the process lifetime and Windows reclaims it on exit/crash; normal WebView2 subprocesses are unaffected.
- Existing Agent flow (B2,B3,B8,B9,B10,B11,X1,X4,X7,X9,X10): load compiled provider catalog and PATH detection → select an installed CLI → readiness/capability check → accept R2 run → K4 invokes the CLI with native settings → normalized chat events and R8 history → collapse/reopen or Stop → quiet completion.
- Provider permission flow (B9,B13,B24,X7,X12,X21): incoming CLI host permission request → K4 suspends on response channel and emits `PermissionRequested` → K3 updates Snapshot (`S17`) → K1 renders inline "Decline & continue" / "Allow once" card without stealing focus → explicit user choice routes K1→K2→K3→K4 → engine continues safely or finishes gracefully. Stop/timeout/unsupported request sends Decline/Cancel, never auto-approve.
- Staged Capture & Dual Hotkey flow (B4,B20,B22,X2,X6,X8,X18,X19): independent Selected Text or Visual Capture hotkey (or composer camera / `Ctrl+V` image) → R3/K5 validates source/target/capability → captures Region Snip, window, scrolling window, full screen, or UIA selected text → stages ephemeral attachment in K3 (`S5`) and reveals composer chip + Quick Actions (or auto-submits only if Instant Auto-Send is enabled) → user picks a Quick Action, types custom prompt, or hits Enter → R9 composes turn with Learning Mode & Profile → engine responds → Drop cleans ephemeral temp file.
- Turn Control & Queue flow (B23,X4,X20): while streaming, user may queue one follow-up in `S17` (auto-dispatches when active run completes; restored to composer draft on Stop/error); explicit Stop preserves already-streamed assistant text marked `Stopped` and persists `interrupted: true` without fabricating completion; Retry/Edit creates a new run from the targeted prompt; completed answers expose Copy, universal caret Insert, and 3–4 quiet learning follow-up chips on the latest turn.
- Cross-runtime history (B14,X13): finish/stop run → preserve R8 conversation → close K4 session → select runtime/model → reconstruct bounded persisted messages or disclose missing native context.
- New Chat (B9): after a terminal run, user explicitly resets the conversation from the Agent chat header beside Settings -> R2 closes and waits for the owned provider process -> persists old history, creates a new conversation, and clears runtime transcript. An active run cannot be reset implicitly.
- Interruption (B8,X4,X10): collapse/switch = continue; Stop = cancel owned run and reject late output; app exit = terminate owned child work; crash/restart = show only independently verifiable provider history, otherwise interrupted/unknown.
- Capture (B4,X2,X6,X8): explicit action -> R3 verifies assigned shortcut + selected source + pinned non-Otto target when required + capability -> capture one window, a stitched scrolling window, or the full screen -> user-chosen provider receives image -> response -> delete temp. Invalid/denied -> nothing submitted.
- Shell (B1,B2,B7,B10,X5): R6 configures host/capture protection -> R1 lays out the Agent or settings stage from Rust layouts -> latest-frame queue publishes rendered physical geometry -> K5 applies its region -> acknowledged placement updates R1 -> hover opens the Agent composer without taking focus. A pointer leave is checked against current native pointer position and DOM hit testing before collapse. Background Agent updates never navigate. One effective duration drives stage and radii; K2 never warps the host for surface navigation.

## Guarantees
- G1 (B4,Q5,C6) [H]: without an explicit user capture action, no image is captured/submitted; SLI unauthorized capture/send invocations = 0 per invocation trace at R3 boundary (no image logging).
- G2 (B3,X4) [H]: after Stop or app exit, owned CLI process-tree survivors = 0; Windows Codex children are attached to a kill-on-close Job Object and launch fails closed if attachment fails. Assignment occurs after spawn, so wrapper pre-assignment races and crash behavior still need representative Windows proof.
- G3 (Q2) [M]: navigation/Stop remain responsive while CLI is busy; SLI p95 input-to-view response and frame intervals at WebView/host; target TBD from A2, no invented latency SLO.
- G4 (B1,B7,X5) [M]: UI remains accessible even when tool-window styling or capture affinity is unsupported; R6 verifies HWND style bits while actual picker omission and protected capture must be observed with representative Windows recorders. No universal exclusion guarantee.
- G5 (Q1) [M]: measure idle CPU/private memory of Otto+WebView2 process family separately from CLI and capture p95 frame intervals during morphing at OS/WebView; targets TBD from A2.
- G12 (Q1,C3,B1,B11) [M]: Compact does not initiate provider readiness CLI subprocesses; canceled probes own process-tree cleanup, and reopen uses a short verified-result cache while Rust revalidates every actionable request.
- G6 (B9,C7) [H]: provider-native tool and permission settings are passed through without Otto overrides; SLI injected tool-policy flags or permission settings = 0 at the K4 launch boundary.
- G7 (B8,X10) [H]: collapse/switch never cancels or loses an accepted run; SLI implicit cancellations on UI-only transitions = 0, observed at R2 run state and K1 event reconciliation. Restart must not fabricate completion.
- G8 (B9,B13,B24,X7,X21,C7) [H]: Otto never auto-approves provider permission requests; every `Allow once` requires an explicit user click correlated by `request_id`, and timeout/Stop/dismiss defaults to Decline/Cancel; SLI auto-approved or unconfirmed permission approvals = 0 at the K4 protocol boundary.
- G9 (B10,Q4) [M]: background completion does not change the active Agent/settings surface or take keyboard focus; SLI unsolicited focus/surface changes = 0, measured at R1/R6 transitions.
- G10 (B11,X1,X9,Q3) [M]: absent/unauthenticated/unsupported providers cannot accept runs; SLI accepted requests with invalid readiness = 0, measured at R7 validation/submit boundary.
- G11 (J1,Q6) [M]: user can obtain, persist, reopen, and reuse an answer without launching another app; SLI successful ask -> history reopen -> follow-up -> return-to-origin journey on a Windows walkthrough; success threshold not yet set (A7).
- G13 (B14,X13,C8) [H]: runtime/model switch never changes persisted Otto conversation identity or claims fake native resume; SLI false native-continuity claims = 0 at R8/UI history projection.
- G14 (B13,X12,C7) [H]: Otto dispatches no file-edit or shell effects from an Agent run; provider-native effects remain under the CLI and its own settings.
- G17 (B7,Q4,X17) [M]: the native input region covers the rendered silhouette plus its conservative physical-pixel antialias fringe, never the transparent host rectangle. SLI silhouette point mismatches = 0 at the K5 region readback boundary outside that fringe; attached keeps `y = monitor origin`, region width = body + 2 x shoulder, and ignores the floating offset. Click pass-through to the window beneath the shoulder corners still requires representative Windows acceptance.

## Challenge
| H flow | Failure / threat | Blast radius | Containment | Detection signal | Recovery |
| --- | --- | --- | --- | --- | --- |
| G1 capture | implicit trigger, wrong target or sensitive image sent | screen privacy | only explicit hotkey; pin/recheck target; capability gate | R3 send provenance vs action | reject capture, delete temp, ask user to retry |
| G2 agent exit | CLI descendants remain alive, stale stream after Stop | local tools/resources and misleading answer | owner-scoped process tree; terminal run state | R2 process exits, surviving descendants, late event count | terminate owned tree, mark run cancelled |
| G6 native config | adapter injects a tool/permission override or isolated provider config | provider behavior and local work | inherit provider configuration and pass no tool-policy overrides | launch arguments and provider request payload | remove override and retry with CLI-native settings |
| G7 continuity | UI unmount/collapse drops stream or cancels CLI | active conversation | run owned outside view; replay buffered current result by run_id | R2 transition and K1 resubscription gap | resubscribe/reconcile, mark interrupted only if genuinely lost |
| G8 pending permission | provider needs a host permission decision during a turn | provider turn and local system | never auto-approve; pause K4 on explicit `request_id` channel; timeout/Stop/dismiss resolves Decline/Cancel | incoming permission RPC, `request_id` match, and user decision log | user chooses "Decline & continue" or "Allow once"; fallback graceful decline or Retry |
| G13 portable history | native session lost or incorrectly claimed after provider switch | conversation trust | R8 transcript + labeled reconstruction | R8 provenance and UI | reopen saved messages, disclose lost context |
| G14 Otto effects | an Agent run invokes an Otto-owned edit or shell executor | local files and processes | no such executor or dispatch path exists | K3/K4 call graph and adapter payload | remove the dispatch path; provider-native behavior stays with its CLI |

## Decisions
- DEC29 [two-way] (R1/R6,B2/B7/B19): use one Mac-native sizing path in the stable host and shared Agent/settings surfaces; remove the preset selector and legacy dimensions as explicitly requested. Display/placement changes reconfigure the host. Camera-safe content is a separate inset, not padding applied to Compact Agent. Attached surfaces add the measured safe top inset; no eye-only idle row remains. Mac AppKit/CoreGraphics dependencies reuse locked objc2 versions; measurement failures use an explicitly approximate envelope while conservatively reserving the available menu inset. Mac native input shaping is not implemented by the existing Windows region adapter; macOS build, menu-bar placement and click-through require separate native verification before claiming Mac production readiness.
- DEC1 [one-way]: owner chose Tauri 2 + React/Vite/Tailwind + Rust/Bun over native Slint for faster UI iteration. Trade-off: WebView2 process/memory and window composition behavior; revisit only if representative Q1/Q2 measurements show a material problem.
- DEC14 [two-way] (G12,P7): keep one WebView and persistent chat event subscription/hotkey; readiness probes use a Rust-owned, request-ID cancellation gate and frontend 60-second ready-only cache. Cancel drops the bounded CLI probe future and its Windows Job Object, never the live chat transport. Refresh bypasses cache; Rust verifies new requests and captures, except that a completed, still-owned Agy chat transport with identical provider/model/thinking/capture context can send follow-ups directly. Agy reports auth expiry and other failures from each live turn; a failed/disconnected transport cannot reuse this exception.
- DEC2 [two-way]: one modular desktop app and feature-owned states over additional service/global store. Trade-off: in-process crash affects the shell; revisit for proven isolation need.
- DEC3 [two-way]: provider-specific structured protocols and ordered run channels over generic terminal text/events for high-frequency streaming. Trade-off: more adapter work; revisit with real CLI protocol constraints.
- DEC11 [two-way] (B3/B9/C7): Pi model catalog and selected-model capability come from its native JSONL RPC session; full provider/model IDs preserve nested slashes. Model/thinking are confirmed before each request; session token statistics remain best-effort and do not fabricate context counts. Assistant message errors are provisional until `agent_settled`; automatic retries may recover, each new assistant attempt replaces previous partial text, and an unresolved error or incomplete final message cannot complete the turn. Pi publishes Stopped only after closing its control receiver and terminating its owned process tree, so an immediate New Chat cannot race a still-closing transport. Pi launches `pi --mode rpc` and keeps its native tools, sessions, extensions, MCP, skills and approval settings. Screenshots use Pi RPC `prompt.images` (Base64 PNG), with selected-model image capability required before capture and again before submission. Provider/model/thinking changes are locked during an active run. Capture uses a separately owned native selection confirmed through readiness; previous answer metadata is not overwritten by UI selection. Follow-up setup is interruptible before prompt submission and stale usage is cleared at turn acceptance.
- DEC12 [one-way] (B3/B9/C7): supported compiled adapters are Codex, Pi, OpenCode, Claude Code and one generic ACP adapter (`providers/acp/`, per-CLI `AcpSpec` in `spec.rs`: executable names, launch args, optional `authenticate` method) serving Agy, Gemini CLI, GitHub Copilot, Qwen Code, Cursor Agent, Goose, Mistral Vibe, Amp, Kilo Code, Junie, Cline, Augment Code, Factory Droid, Grok Build and Devin, with launch commands taken from the official ACP registry; a new ACP CLI is a `ProviderId` variant plus one spec entry. Otto only detects CLIs already on PATH and never downloads or runs `npx`/`uvx` bridges; registry-only distributions without a Windows executable (for example Kiro) are not offered. Provider logos are the registry's monochrome SVGs rendered as masks in the text color; ACP host permission requests stay a visible recoverable error; PATH detection reports their installed subset. Each CLI uses its native authentication, configuration, tools and permission rules. Codex app-server requests omit sandbox/approval overrides. Pi runs `pi --mode rpc` without tool-disabling flags. Agy runs `agy acp --stdio` without a custom agent, sandbox, or permission override; provider tool-call updates do not fail the run. OpenCode runs `opencode run --format json` with the current working directory and normal CLI configuration, without an isolated profile or tool-deny agent. Claude Code uses print-mode streaming without `--tools`, allowlists, permission-mode or sandbox overrides. Otto does not render provider tool events as Otto actions or auto-approve host permission requests; a request requiring a host decision produces a recoverable error. CLI model/session probes and Windows auth/follow-up/Stop/process cleanup still need acceptance before release.
- DEC4 [two-way]: Windows 11 native APIs, Tauri content protection, untitled main HWND and WS_EX_TOOLWINDOW over switching UI frameworks for source-picker suppression. Untitled tool windows are skipped by some WebRTC enumerators; filtering is caller-specific and cannot guarantee universal exclusion. Trade-off: missing native window title affects accessibility/discoverability; preserve visible Otto UI and revisit if tested pickers still enumerate the HWND.
- DEC5 [one-way] (G6,G14): Otto does not impose provider tool or permission policy and owns no Agent edit/shell effects. K4 passes native provider settings through; Windows Job Objects constrain process lifetime only, not filesystem permissions or CLI actions.
- DEC6 [two-way]: Otto stores versioned local text conversation history in app data, but never provider credentials, screenshots, cwd, or provider thread IDs. Atomic JSON avoids a new database dependency until history volume proves it necessary.
- DEC7 [one-way] (B9,B13): Otto owns no file-edit, shell, or workspace tool loop and has no separate Coding mode. Each installed CLI keeps its native tools and permissions.
- DEC8 [one-way] (B9,B13,X7): provider-native tool activity is not filtered by Otto. Otto never auto-approves a provider permission request; if the CLI requires a host decision Otto cannot show, the run receives a recoverable error.
- DEC9 [two-way] (B14,X13): runtime/model/thinking fixed per active run; Otto conversation independent of provider native session; a switch reconstructs bounded saved transcript only when native resume unavailable and labels loss of native context.
- DEC10 [two-way] (B2/B3/B8/G7): retain feature-first UI and a small root composition coordinator; extract individual hooks by state/side-effect lifetime as problems are addressed, over global Redux/context layers or a generic clean-architecture directory hierarchy. Trade-off: some current facades remain large until proved refactors; revisit if an independent feature needs a shared authoritative state owner.
- DEC13 [two-way] (B3,B9,B13,C8): typed provider contracts behind a compile-time adapter catalog. Codex/Pi/Agy/OpenCode/Claude Code adapters preserve existing CLI auth and native configuration; installed commands are detected from PATH. K4 owns protocol/process/session differences; provider tool policy stays in each CLI. A new provider needs an adapter plus static registration. No direct API/cloud gateway or dynamic plugin loader under C2 and current scope.
- DEC16 [two-way] (B13,B14): modular monolith with feature-first React and domain-first Rust; K1 UI → K2 host/IPC → K3 provider-agnostic core ← K4 adapters and K5 Windows effects. K3 remains free of Tauri and provider/OS implementations; ports exist at real substitution or trust boundaries, not as a generic clean-architecture layer or new crate.
- DEC17 [one-way] (B14,G13): R8 owns conversations, R2 runs, R7 provider readiness/capabilities, R9 prepared text/image context, K4 ephemeral native sessions and provider processes; frontend Snapshot is a read projection.
- DEC18 [two-way] (B4,G1): Windows capture/hotkeys report explicit intent and results through the host IPC capture bridge and typed Agent capture lifecycle; Windows modules do not own or call AgentRuntime state. Preserve explicit consent, target validation and cleanup.
- DEC21 [two-way] (C3,G5): retain the Windows system font stack and remove unused bundled UI-font dependencies from the Agent path. Driver: the current UI does not import Plus Jakarta Sans, while WebView2 already supplies the selected stack. Trade-off: no brand-font portability; revisit only if visual requirements or a measured Windows baseline require a bundled font.
- DEC22 [two-way] (C3,G5,P14): defer the rich transcript renderer and its KaTeX/highlight resources behind the Agent transcript boundary, while keeping the current safe renderer contract. Driver: the current production build emits 59 KaTeX font assets totaling about 1.07 MB and an 846 KB main JS chunk. Trade-off: first rich transcript use pays a chunk load; revisit if measured interaction latency or offline startup requires eager loading.
- DEC25 [two-way] (C3,G5): optimize the shared frontend by dependency boundary before component surgery: lazy-load Agent rich rendering, keep KaTeX WOFF2-only in the WebView2 path, and retain tree-shaken named icon imports. Driver: asset cost is concentrated in Markdown/KaTeX/highlight, while `lucide-react` source disk size is not evidence of shipped bundle cost. Trade-off: optional resources have a first-use load and need a recoverable fallback.
- DEC26 [two-way] (B2,B7,Q2): keep one shell facade and extract navigation, preferences, native placement/capture readback, or focus only when a changed behavior needs an isolated owner/proof. Driver: the current shell hook has multiple lifetimes, but a wholesale split would risk Compact/Preview/Pinned and focus semantics. Trade-off: the facade remains large during incremental migration.
- DEC15 [one-way] (P14,X11,G1/G7,K1): answers render through `MessageContent` with `react-markdown` + `remark-gfm` + `remark-breaks` + `remark-math`/`rehype-katex` and a curated `highlight.js` language set, never `rehype-raw`, so provider HTML/script stays inert and link/image URL schemes outside http(s)/mailto are dropped; markdown images render as inert links, so model output cannot trigger network egress. Code fences are highlighted by highlight.js and injected as `innerHTML` only from source escaped by `src/features/agent/transcript/content/markdown-highlight.ts` (unlabelled fences stay plain, no auto-detection, so streaming never re-guesses a grammar); that single sink is the only `security/noDangerouslySetInnerHtml` override in `biome.json`, and `tests/agent/message-markdown.test.mjs` must keep the escaping and no-remote-fetch regression green. Copy on a code block uses the exact fenced source text; math degrades to safe spans instead of failing the run. Dependencies enter only through `bun.lock` pinning. Asset loading policy (lazy vs eager) belongs to DEC22/DEC25 and is not decided by this safety rule.
- DEC23 [two-way] (B7,G17): both placements use the rendered stage's physical silhouette, not the host rectangle. Shoulder/radius tokens remain in `src/style.css` with native drift proof. Physical body bounds round outward, radii inward, and native scanline envelopes preserve curve fringe instead of an inward-rounded ten-segment polygon. Only a conservative pixel-edge envelope is admitted; it must not become a blocking host rectangle. GDI containment proof does not establish WebView2 antialiasing or compositor synchronization; 100/150% DPI edge and click-through acceptance remains required.
- DEC28 [two-way] (B2,B7,S2,G9,G17): keep a stable monitor-bounded 550x610 maximum host across ordinary navigation; reconfigure only for placement, offset, display/DPI changes or explicit Retry. Rust supplies the surface-size map; K1 owns stage timing and a single-flight latest-pending region queue with revision guards. Measure only natural active content, resolve settled width/height and centered stage translation to the confirmed host's physical pixel grid, and deduplicate equal region geometry. The centering correction shares the stage morph duration; acknowledged recovery coordinates are not translated. Attached shoulders belong to the stage, not wrapper padding. Process-local transparent WebView2 startup and transparent Tauri background precede creation. Trade-off: native IPC and composition are not atomic; failure freezes acknowledged geometry with draft-preserving Retry, and native visual/input proof remains a merge/release gate.
- DEC30 [two-way] (B21,B9,C7): compose Personal AI Assistant & Learning Mentor framing (6 curated fixed Learning Modes: Direct, Solve for verified math/logic/competitive programming, Mentor, Simple, Write & Translate, Practice + static Profile & Learning Style) at K3 `agent/runtime/prompt.rs` rather than adding a dynamic cross-session memory store, custom preset CRUD, or coding workspace picker. Trade-off: no automatic long-term user memory; revisit only if learners prove static profile + 100-message history insufficient.
- DEC31 [two-way] (B22,G1,X19): default Capture to staged-first composer attachments (with optional Instant Auto-Send toggle), add Windows native Region Snip and `Ctrl+V`/drop image staging under Rust-owned ephemeral `CapturedImage` Drop lifetimes, and split capture triggers into two independent global hotkeys (Selected Text vs Visual Capture) plus a composer camera source menu. Trade-off: extra key-binding slot and native snip overlay maintenance; revisit if Windows hotkey contention proves common.
- DEC32 [one-way] (B24,G8,X7,X12,X21): replace fatal permission-request termination with explicit K3-mediated inline host-permission decisions (`Decline & continue` / `Allow once`) correlated by `request_id` over a suspended K4 protocol channel, keeping `G8` (zero auto-approval) and zero Otto-owned tool execution intact. Driver: prevents coding CLIs from crashing learning turns when they probe for host confirmation while preserving strict user consent. Trade-off: adapter protocol complexity across ACP/Codex; revisit if a CLI protocol omits structured denial replies (in which case terminate cleanly and preserve partial text).
- DEC33 [two-way] (B23,B24,C3): raise conversation transcript/history cap from 24 to 100 messages (keeping bounded context reconstruction on switch), preserve stopped partial text marked `Stopped`, add Rust-owned Retry/Edit/single-slot follow-up queue, keep Codex (`app-server` persistent thread) and OpenCode (`--session`) multi-turn sessions alive where supported, eliminate redundant pre-turn readiness subprocesses for healthy sessions, add Claude Code model/effort/image and OpenCode image parity where native CLI flags support them, and provide on-demand live Windows environment PATH refresh. Trade-off: larger JSON history records and per-adapter protocol maintenance; revisit JSON storage only if measured read/write latency degrades at 200x100 scale.

## Fitness
- F1: Tauri imports and native event wiring exist only in `src/platform/`; render-only feature TSX has no runtime platform imports (type-only snapshot imports allowed) | signal: TypeScript import scan | tool: `scripts/frontend-rules.mjs` | pass: zero boundary violations | cadence: PR | mode: enforce; exceptions -> D#.
- F2: feature modules and root composition import features only via public `index.ts`; `shared/ui` never imports feature or platform code | signal: TypeScript import scan | tool: `scripts/frontend-rules.mjs` | pass: zero boundary violations | cadence: PR | mode: enforce; exceptions -> D#.
- F3: UI uses shared semantic design tokens from `src/style.css`, not new hard-coded palette values per component | signal: changed CSS/TSX | tool: `scripts/frontend-rules.mjs` R1/R2 | pass: no raw color literal in TS, none in CSS outside `@theme` | cadence: PR | mode: enforce (ratchet vs `.agents/frontend-budget.json`); exceptions -> D#.
- F4: the frontend does not grow more complex than the recorded budget | signal: largest component file, largest non-TSX module, features missing a public entry, total Biome diagnostics, aria-label count, hand-drawn SVG count | tool: `scripts/frontend-rules.mjs` R3–R8 | pass: each metric ≤ its baseline | cadence: PR | mode: enforce as a ratchet — lower it freely, never raise it to pass; exceptions -> D#.
- F5: icons are a vetted dependency and accessible names are rendered text | signal: `lucide-react` in `package.json`/lockfile, `shared/ui` as the only icon source, no `aria-label` | tool: `scripts/frontend-rules.mjs` R6/R7 | pass: 0 `aria-label`, 0 inline `<svg>` outside `shared/ui` | cadence: PR | mode: enforce; exceptions -> D#.
- F6 [enforced]: Rust core modules outside `agent/providers/` may not import concrete Codex/Pi/Agy/OpenCode/Claude or `platform/windows/` implementation modules; `scripts/rust-boundaries.mjs` runs in `bun run check` at PR gate; static import-boundary proof, not runtime process isolation.
- F7 [enforced]: `platform/windows/` may not import `AgentRuntime`, conversation persistence, or invoke core capture lifecycle methods; `scripts/rust-boundaries.mjs` runs in `bun run check`, while the `ipc/agent_capture.rs` adapter owns capture dispatch and error projection.
- `bun run check` runs Biome plus both ratchets and the boundary scans, so F1–F4 and F11–F13 are executed at PR cadence and are proof when it exits 0. Baselines live in `.agents/frontend-budget.json` and `.agents/rust-budget.json`; lower them after a real reduction (`bun run lint:frontend -- --write-baseline` for the frontend) and never raise one to pass.
- F1/F2 enforce import direction today; TSX-size ratchet does **not** cover large `.ts` hooks or validate behavioral ownership. Do not claim these checks prove SRP, runtime lifecycle, or React state correctness.
- F9: `useAgent.ts` is a composition facade: direct platform calls and lifecycle effects live in the extracted Agent hooks, and rich transcript dependencies do not enter the shell entry chunk | signal: import graph plus production asset report | tool: existing boundary checks and Vite build output | pass: facade imports only public Agent hook contracts and optional renderer assets are split | cadence: PR | mode: warn during extraction, enforce after the first complete slice; exception -> D8.
- F10: frontend files are classified by owner and dependency cost before splitting | signal: changed file, import graph, and production asset report | tool: code review plus existing `bun run check`/Vite output | pass: every new extraction names its owner and every asset optimization preserves the public feature contract | cadence: PR | mode: enforce; exceptions require a D#.
- F11: the IPC layer maps and validates commands and delegates; notch surface sizes, content-height bounds and placement math live in `shell/notch.rs`, and native window application stays behind `platform/windows/` | signal: Rust import scan plus prod lines per command file | tool: `scripts/rust-boundaries.mjs` | pass: zero geometry tables/placement math under `ipc/`, one bounded context per command file | cadence: PR | mode: enforce; exceptions -> D#.
- F12: prod Rust files stay within the recorded ratchet, one state owner per file | signal: prod lines per file (before `#[cfg(test)]`) | tool: `scripts/rust-boundaries.mjs` against `.agents/rust-budget.json` | pass: every file ≤ its recorded ceiling | cadence: PR | mode: enforce as a ratchet — lower freely, never raise to pass; exceptions -> D#.
- F13: non-TSX frontend modules stay within the recorded ratchet | signal: `.ts` line count | tool: `scripts/frontend-rules.mjs` against `.agents/frontend-budget.json` | pass: every `.ts` file ≤ its recorded ceiling | cadence: PR | mode: enforce as a ratchet; exceptions -> D#.

## Debt
- D1 (S8,P3/P8): Agent submission draft ownership uses the backend `accepted.runId` rather than text or relative run ordering; terminal events affect only that accepted request, and stale acknowledgments cannot modify newer input or error. `useAgent.ts` still composes connection, readiness, capture, history and submission; extract further only when a separate behavior requires it.
- D8 (K1,G5): Agent lifecycle hooks have been extracted; do not plan another facade split from the obsolete pre-extraction line count. Rich transcript JS and KaTeX CSS load only for a nonempty assistant answer, with current plain text during pending/failure; a failed optional renderer stays plain for the process lifetime. F9 remains incomplete in current source; the target capture seam is `features/agent/capture/useAgentCapture.ts`. Legacy KaTeX font formats remain bundled; asset splitting is not proof of lower native CPU/private memory. Revisit only for a further capture ownership change or measured asset/startup cost; preserve the public Agent model and run/capture/history behavior.
- D16 (K3,K4,G5): provider adapters under `agent/providers/{pi,codex,acp,opencode,claude}/` and `platform/windows/capture/` are split by owner (readiness / turn / protocol / target / image / hotkey) to stay within the F12 ratchet (`maxProdLines` in `.agents/rust-budget.json`).
- D17 (K2,F11): `ipc/notch.rs` retains Win32 host/region application and readback transaction orchestration; pure layout, bounds, revision and sequence policy live in `shell/notch.rs`, while silhouette rasterization lives in `platform/windows/region.rs`. Revisit if a second caller needs the same native transaction.
- D10 (K1,C3): several TSX files are near the line ratchet but remain cohesive compositions; do not split them solely to lower line count. Pay down only when a component gains a second state owner, a separate async lifecycle, or an independently testable surface.
- D9 (B7,G17): frame reports and `SetWindowRgn` are not compositor-atomic. Conservative physical-pixel regions fix proven inward clipping, but white backing, transient corner interception and antialias edge quality still require representative Windows acceptance; DOM bounds and GDI shape tests are insufficient. Trigger: visible clipping/flicker or pointer interception at rounded edges.
- D2 (S1,B2): Shell interaction, hover, focus, preferences and placement have dedicated hooks; `useNotchShell.ts` composes them and mirrors observed placement into saved preferences. Further extraction requires a changed responsibility and isolated proof, not the obsolete monolithic-hook description; preserve Compact/Preview/Pinned semantics.
- D3 (K1): `AppView.tsx` uses explicit narrow feature contracts instead of hook `ReturnType` signatures, keeping render types decoupled from controller internals.
- D4 (F1/P14): `src/features/agent/transcript/content/CodeBlock.tsx` renders highlight.js HTML through `dangerouslySetInnerHTML` with a scoped Biome `noDangerouslySetInnerHtml` override in `biome.json`. Only `CodeBlock.tsx` may keep this override; it must render highlight.js output over markdown source that react-markdown already sanitized (no `rehype-raw`). Removing the override depends on a structured-token renderer.
- D5 (B3,B14,G13): R8 `agent/conversation/` owns conversation ID/history and transcript operations (start turn, append delta, final text and run-specific answer); R2 `events.rs` owns event ordering and terminal transitions, delegating message updates to R8. Restore validates the chosen record before rotating, flushes/reloads a currently active record before reset, and uses a prevalidated record after closing native transport; no fallible history read occurs after clearing active Snapshot. Active history delete closes transport and deletes the stored record before rotating while holding the R8 conversation-ID mutex across delete and Snapshot rotation (ID lock before history-store writer), preventing observer resurrection; failed deletion keeps transcript and conversation ID, invalidating only the closed native thread. Writes reject stale IDs; new-session ID plus Snapshot handoff is serialized. Snapshot remains a read projection; native cross-provider resume is unsupported.
- D6 (B4,G1): Windows capture now supplies explicit OS capture results through `ipc/agent_capture.rs`; core owns `begin_capture`, provider admission, asynchronous submission, clean cancellation reset, and failure projection. Windows retains target selection, hotkey registration, one-shot/full-screen/scrolling/drag-area capture, native capture file lifetime and cleanup. Area capture (`platform/windows/capture/region.rs`, `region_overlay.rs`, `region_scroll.rs`, `region_state.rs`) uses thread-scoped low-level mouse/keyboard hooks and a non-activating, untitled, hollow 2px border overlay with fail-closed `WDA_EXCLUDEFROMCAPTURE` readback before and after first show, zero screen dimming or cursor change, live wheel-scroll stitching (`RegionScrollCanvas`) that keeps the initial `(X1, Y1)` content anchored as the top boundary while the underlying page scrolls to `(X2, Y2)`, 60s self-cleaning selection deadline, and `Esc`/right-click cancellation that swallows button/key release without triggering underlying app actions. Scrolling capture bounds frame count, duration, dimensions and pixels, restores the cursor, best-effort restores prior Otto focus only while the target still owns foreground, and excludes the scrollbar guard strip from stitched output. Native Windows proof is still pending.
- D15 (B20,C6,Q5): Selected-text capture reuses the explicit capture hotkey and core reservation, but bypasses image capability admission. K5 reads only the focused element's UI Automation TextPattern selection, bounds and normalizes it without clipboard access, and returns text to K3. K3 wraps it as untrusted ephemeral provider context, persists only the generic user request, and never reconstructs the captured selection from history. Unsupported or empty selections fail before provider submission. Completed-answer insertion is a separate explicit K1→K2→K5 action: K1 removes only standalone Markdown fence lines, preserving all other characters, line breaks and indentation; K5 revalidates and focuses the last external window, maps CRLF, LF and CR to Enter key pairs, then sends every other bounded character as Unicode keyboard input without clipboard access; failure preserves the answer and reports recovery.
- D12 (B2,B7,G9): stable-host implementation replaces grow/deferred-shrink calls (DEC28). Target-layout content remains inside the independently animated stage; host revisions cancel obsolete frame queues and acknowledgments. A bounded frame loop plus transition-end reporting sends settled geometry; equal physical geometry is deduplicated. Per-frame native window resizing and rectangular region clearing are removed. Native input/compositor acceptance is still pending, not implied by the implementation.
- D7 (B7,X5,G4): the main window is created hidden, overlay-configured, host-configured and region-verified before show, then overlay-configured again. Showing a never-shown window discarded the tool-window exstyle applied while it was hidden (first visible frame stayed `WS_EX_APPWINDOW` for about 220 ms). Evidence: `tests/e2e/shell-native.ps1` first-frame exstyle must stay `WS_EX_TOOLWINDOW` without `WS_EX_APPWINDOW`.
- D14 (K2): host configuration and rendered-region application are separate mutating IPC boundaries with one `NotchHostState` owner. The configure result carries the authoritative Rust layout table; no frontend duplicate surface table or old measurement command remains. A changed client/revision invalidates previous sequences. Native layout/input acceptance remains governed by PF10/PF14.
- D11 (B7,G3/G5): the Compact Agent capsule remains aligned with the shell stage during the same-duration silhouette morph; the native window no longer warps (D12). Content stays inside the target layout so the Agent activation control remains undistorted and clickable. Trigger: a WebView2 frame-pacing measurement (G5) naming the paired morph as the dominant cost.

## Verification
- PF22 (R1/R6,B2/B7/B19,P2/P18/P22) [important]: Rust `shell::sizing` behavior proves the sole native sizing path, logical cutout resolution, invalid/missing/notchless fallback and camera-safe Agent/settings layouts; Bun `tests/shell/notch-sizing.test.tsx` proves retired sizing preference migration without losing other settings, no selector, content inset/DPI bounds and reduced-motion Agent capsule behavior. Native GDI geometry tests and transition capture assert 13px Compact / 18px Expanded corners, with flat tops only when attached. Existing shell transition/placement proofs cover revision interruption and collapse continuity | `iter/pr`; identical-state private native screenshots and physical Mac geometry/menu/input verification | `release`. Windows fallback screenshots are not evidence of AppKit or hardware correctness.
- **Critical-proof contract (P#/X#/G#):** changed core state, provider lifecycle/Stop, native permission-request recovery, concurrent ordering, capture consent/target, and restart/recovery need behavior-based proof. Prefer the cheapest faithful boundary proof; no test-count or coverage quotas.
- **TDD default for critical logic:** name the property and failure → observe Red on a targeted regression test → minimum Green implementation → Refactor. Red must fail for the intended behavior, not just broken setup. If a faithful Red cannot be observed, explain the exception in the PR and show the closest reliable behavior proof. A critical proof must detect the regression; mocked calls, constants and implementation snapshots alone do not qualify.
- `iter`: run only affected checks and tests via `bun run test:affected` (uses `scripts/test-affected.mjs` to select dependent Bun/Node tests and filtered `cargo test --lib -- <filters>` modules, with `--plan`, `--staged`, `--base`, `--with-checks`, or explicit file paths); do not run the full frontend, Rust, or native E2E suites for localized edits.
- **Component interaction proofs** run under Bun with `happy-dom` + `@testing-library/react`, preloaded by `tests/setup/dom.ts` through `bunfig.toml`, and render production components against mocked `src/platform/` transport. They prove React wiring that pure state tests cannot (pointer/keydown/focus/effect ordering) and are neither E2E nor proof of native behavior. `bun test --isolate` gives each test file a fresh module registry, so a file that mocks `src/platform/tauri` cannot change what another file imports; `mock.restore()` alone does not cross that boundary.
- `pr`: `Otto CI` runs on `pull_request` events and manual `workflow_dispatch`. `changes` runs `node scripts/test-affected.mjs` to dynamically select only affected frontend check/build steps, exact dependent Bun/Node test files, filtered Rust `cargo test --lib -- <filters>` modules (skipping Rust fmt/clippy when no Rust source changed), and only the affected native E2E suite(s) (`shell`, `transitions`, `p8`); unrelated jobs and steps are skipped, and WebDriver setup runs only when `transitions` or `p8` is selected. Non-Codex provider edits (`pi`, `claude`, `agy`, `opencode`) and capture edits skip `native` and debug `Otto.exe` builds entirely. Manual `suite=full` and `master` `release.yml` remain the full-suite safety net. Close other Otto instances before native acceptance; preserve active Agent runs. Cargo check is covered by test compilation and Clippy `--all-targets` in CI; `master` release also runs explicit Cargo check. Record exact-SHA check results; caches and an older green run are not proof of the delivered HEAD. No duplicate branch-push verification or AI API calls.
- PF1 (P3/P9,G6/G8,X9) [critical]: provider adapters add no tool/permission overrides, provider-native tool events do not fail a turn, and host permission requests are never auto-approved; authentication failures remain recoverable | Rust provider contract proof (`providers/codex/requests.rs`, provider adapters, `providers/agy/`); installed-CLI checks in `providers/tests/acceptance.rs` are opt-in, not substitutes for authenticated model access | `iter/pr`.
- PF2 (P3/P8,G2/G7,G9) [critical]: Rust streaming/Stop/order unit + Codex subprocess contract in PR; Windows suspended-start Job assignment, piped stdout and timeout probes in Rust tests at `pr`; native P8 stream → collapse → Agent composer reopen → background completion in manual `full` E2E, with a held foreign foreground window that must still own focus when the answer completes; process-tree/descendant cleanup acceptance at `release`. The P8 harness rejects an existing active Agent marker, releases its owned streaming fixture and waits for terminal cleanup even after a failed prerequisite; a remaining active marker preserves Otto, driver and fixture profile instead of forcing termination.
- PF3 (P4/P11,G1) [critical]: explicit capture action, target identity, no implicit send on invalid/ambiguous state, clean area-selection cancellation/state transitions, anchored live wheel-scroll stitching during area drag (`region_scroll`), non-activating hollow capture-excluded native selection overlay (`region_state`, `region_overlay`, `tests`), and bounded scrolling overlap/stitching with sticky chrome and scrollbar exclusion | Rust capture unit + native Win32 overlay proof + frontend `tests/agent/agent-capture-source.test.tsx`; interactive desktop `BitBlt` recorder exclusion, drag-area walkthrough, and Windows capture-to-Codex/Pi acceptance | `iter/pr`, native at `release`. Native capture deadline retains the Win32 reservation until the blocking operation finishes; area selection owns a 60s Win32 timer under a 65s outer deadline.
- PF23 (P4/B20/X18/Q5) [critical]: selected text is collected only after the Selected Text hotkey, bounded and normalized without clipboard access, rejected when empty/unsupported, wrapped as untrusted ephemeral context, and admitted for text-only providers without claiming image support. Completed answers from any turn expose Insert after streaming, preserve exact text, map each logical line break to one Enter key pair, keep other characters as bounded Unicode key pairs, revalidate the last external target, and never use the clipboard | Rust selection/context/input-event tests plus capture-source and transcript frontend interaction | `iter/pr`; Chrome/Edge selection plus editable-caret insertion acceptance | `release`.
- PF24 (P23/B21) [important]: 5 curated Learning Modes (`direct|mentor|simple|write|practice`) switch via composer pill or `/slash`, static Profile & Learning Style persists and frames K3 prompt composition within byte bounds, non-technical English UI copy replaces developer jargon, header Engine/Model/Effort popover commits validated runtime options without leaving chat, and collapsible Thinking blocks render safely without losing answer text | Rust `prompt` + `activity` unit tests and Bun composer/header/settings interaction proofs | `iter/pr`.
- PF25 (P24/B22/X8/X19) [critical]: independent Selected Text and Visual Capture shortcuts register/conflict independently; Region Snip, Window/Scroll/Full Screen, Selected Text, and pasted/dropped images stage cleanly in the composer with contextual Quick Actions (and optional Instant Auto-Send); Escape-cancelled snip, unsupported image, or cleared chip leaves draft intact and cleans ephemeral files | Rust dual-hotkey/snip-bounds/attachment-cleanup tests + Bun composer attachment & quick-action proofs | `iter/pr`; native multi-DPI Windows Region Snip overlay and dual-hotkey acceptance | `release`.
- PF26 (P25/B23/X4/X20) [critical]: 100-message transcript/history retention, Retry/Regenerate, Edit & re-run, Stop preserving already-streamed partial text marked `Stopped` (never `Completed`), single-slot follow-up queue dispatch & draft restoration on Stop/error, post-answer learning chips on latest completed turn only, full-text History search, and Markdown export | Rust `conversation` + `runtime` integration tests and Bun transcript/history UI interaction proofs | `iter/pr`.
- PF27 (P26/B24/G8/X7/X21) [critical]: incoming ACP/Codex host permission requests suspend the turn, never auto-approve, accept only matching `request_id` explicit user decisions (`Decline & continue` / `Allow once`), and default to Decline/Cancel on Stop/timeout; persistent Codex/OpenCode multi-turn session reuse, reduced pre-turn readiness spawns, Claude/OpenCode model/image flags, live PATH refresh, and improved CLI error diagnostics | Rust adapter protocol/permission/session contract tests + Bun permission-card UI proof | `iter/pr`; live authenticated Windows CLI acceptance | `release`.
- PF5 (P1,X5,G4) [important]: manifest blank title + contentProtected; native overlay style unit and a real Win32 window affinity round-trip (`platform::windows::overlay::tests::native_affinity`) at `pr`, picker/affinity acceptance at `release`. Windows named mutex duplicate/concurrent/independent-process regression in Rust unit at `pr`; installed Otto double-launch and retained active chat/history at `release`. `tests/e2e/shell-native.ps1` (`bun run test:e2e:shell`, local `release`) measures the real window: blank title, WS_EX_TOOLWINDOW on the first visible frame, display affinity `0x11`, exclusion from a BitBlt screen capture over a painted backdrop, hover while an owned foreign window holds foreground, confirmed native click-to-focus, settled pin persistence after pointer leave, outside-click blur collapse and Escape collapse. Failed foreground/input prerequisites or an undelivered/ineffective Escape fail the gate; Compact corner checks require a restored Compact surface. `-SkipCapture` bypasses all pixel capture and explicitly reports capture as not run; the default capture gate remains unchanged. Cleanup closes only the owned test process and preserves any active Agent run. Source-picker enumeration and third-party recorders stay manual.
- PF4 (P12,X10,G7) [critical]: active marker → crash/restart → interrupted, no false completion; stale run cannot clear new marker | Rust unit + filesystem/runtime integration | `iter/pr`; representative restart at `release`.
- PF7 (P3/P12,P14,P16,G7/G13) [critical]: local history atomic write, reopen, search, rename/delete, interrupted state, and context reconstruction without secrets/images; a Codex → Pi → Agy switch chain keeps one conversation ID, a bounded reconstruction holding both prior answers and no native-thread claim, and the same record after a runtime restart | Rust filesystem integration + frontend contract tests (`tests/agent/agent-history.test.mjs`) + rendered list operations (`tests/agent/agent-history-ui.test.tsx`: open success/failure, edit+Enter rename, Escape cancel, confirm-before-delete, pending/busy gating, search, error retry) | `iter/pr`; restart acceptance at `release`.
- PF8 (P9,G6,B11,Q3,S4,S15) [important]: Agent header shows model/thinking where supported and truthful Ready/Verifying/Unavailable status; Settings → Assistant renders the runtime provider catalog and installed state, a supported model selection reaches `agent_ask`, rejected selection keeps the previous value, and active runs lock selection | Bun render/interaction proof (`tests/agent/agent-header.test.mjs`, `tests/agent/agent-readiness-ui.test.tsx`, `tests/agent/agent-runtime-selection.test.tsx`); native configuration pass-through remains PF1 | `iter/pr`.
- PF6 (P7,G5/G12) [important]: idle no-probe, cache/reopen, selection invalidation and cancel races; completed Agy follow-up without repeat readiness and invalid-state rejection | Bun controller unit + Rust runtime state/control unit at `iter/pr`; real CLI auth/follow-up and process cleanup at Windows `release`.
- PF13 (P14,G1/G7) [important]: markdown heading/list/link/quote/table/task list render, fenced code highlight + per-block copy of source text, inline/block math, escaped/inert HTML and script, empty/unknown-language/unterminated fence and partial-stream inputs; clicking copy hands the exact fenced source or the whole answer to the clipboard, no copy control appears mid-stream, and streaming output follows the bottom only while the reader is there | Bun SSR contract tests `tests/agent/message-markdown.test.mjs` + component interaction `tests/agent/agent-transcript-ui.test.tsx` plus `tests/agent/deferred-message-content.test.tsx` for pending/latest output, failed-load inert fallback, late completion/unmount and code copy; layout completion without a new snapshot follows the bottom only for an already-following reader | `iter/pr`. `bun run build` must keep rich renderer JS/CSS out of the initial entry dependency graph at `pr`; this asset proof does not establish native resource or visual acceptance.
- PF16 (WF1) [critical]: every change has one CI result on the PR head SHA, and each affected contract gate runs dynamically for that SHA without running unrelated suites; native boundaries queue only their affected E2E suite(s) | GitHub check-run + planner proof (`tests/release/test-affected.test.mjs`), not a product test; the SHA recorded in the PR body is the identity | `pr` | `Otto CI` triggers on `pull_request` (`scripts/test-affected.mjs` dynamically selects frontend checks/tests, Rust lint/test filters, and per-suite native E2E), while `suite=full` and `release.yml` remain the full-suite safety net.
- PF17 (WF3, P8) [critical]: the WebDriver session starts from a cold machine, and each unmet precondition is named instead of surfacing as a session timeout | infra proof: pure precondition rule plus real environment collection, because the historical failures were startup preconditions, not app behavior | `pr` (native paths / `full`) | `node tests/e2e/preflight.mjs` runs before spawn inside `tests/e2e/p8-native.mjs`; the rule is covered by `bun test tests/release/preflight.test.mjs`.
- PF18 (WF4, P8/P13) [critical]: no installer is planned or published from a commit whose native journey has not run | pipeline order in `Otto Release`: verify -> debug build -> driver -> preflight -> P8 -> bundle -> checksum -> publish | `release` | `gh run view <release-run>`; every publication step stays downstream of the native step in the same job.
- PF19 (WF2-a, P3/P8,G7) [critical]: a submitted prompt reaches the transport, streamed deltas render in the transcript, and collapsing/reopening the Agent composer keeps that transcript without a reset; Stop returns the composer to Send with the user turn rendered once | Bun component interaction with the real `useAgent` and `useNotchShell` over a stubbed IPC channel, because the uncovered risk is React↔IPC wiring while run ordering stays proven by PF2 | `pr` | `bun test tests/agent/agent-run-interaction.test.tsx` (3 cases, shown able to fail by dropping the channel subscription).
- Gate prerequisites (WF1/WF2/WF5): required status checks on `master` (currently "Branch not protected") and a PR body carrying one `invariant -> PF -> command -> SHA` row per change are repository/process settings an owner must enable; until then a green check is advisory.
- PF10 (P18,X17,G17) [important]: attached geometry (monitor-top origin, `width + 2 x shoulder`, floating offset ignored), saved floating position/reset-to-default bounds, silhouette containment for flare and rounded corners, the real GDI region polygon, and observed-placement readback; a placement Windows refuses reverts to the observed one, persists only that value, shows the failure with retry, and reserves shoulder space only when attached | Rust `platform/windows/region` + `shell/notch` + `ipc/notch` tests and Bun `tests/shell/shell-placement.test.mjs`, `tests/shell/shell-preferences.test.mjs`, `tests/shell/placement-interaction.test.tsx` at `iter/pr`; native `pwsh -File tests/e2e/shell-native.ps1 [-ExpectPlacement attached|floating]` (`bun run test:e2e:shell`) reports the window DPI scale and native region dimensions (not DOM pixel alignment), samples `WindowFromPoint` at the capsule centre and corners (attached corners must not belong to Otto) and requires native click pass-through, 100/150% DPI edge quality and multi-monitor origin at `release`.
- PF15 (Updater,release lane) [important]: the three version sources agree before a release is planned, the app checks the same feed branch and repository the pipeline publishes, and the manifest key is a verifiable minisign public key with a quiet install mode | Bun `tests/release/release-manifest.test.mjs` over the real `package.json`, `tauri.conf.json` and `release.yml`, plus `readBaseline` fixtures | `iter/pr`; installing a published prerelease and restarting with intact history at `release`.
- PF11 (P2,B2,G9,P10) [important]: hover preview without focus theft, pointer activation pinning, Windows focus loss collapsing only a pinned card under `clickOutside`, Keep Expanded holding it, Escape restoring Compact and returning focus without layout-generated hover reopening it (rearm only after a confirmed pointer leave; explicit activation remains available), and settings Escape backing out one level; readiness reaches the rendered surface (sign-in, unavailable and lost-connection states each with their own recovery action, retry re-probing once, composer gated while not ready) and the compact capsule reports `Answer ready` for a finished background answer | Bun component interaction `tests/shell/shell-interaction.test.tsx` + `tests/agent/agent-readiness-ui.test.tsx` | `iter/pr`; at `release`, `tests/e2e/transitions-native.mjs` drives the real Keep Expanded control on/off in both placements and hands its sole process to `shell-native.ps1 -TargetProcessId ... -SkipCapture`. The probe does not launch or close a controller-owned process; it checks native focus/pin/blur/Escape and actual corner clicks received by an owned underlying window (PF10). Unexpected pointer movement invalidates the probe, and an active Agent marker blocks startup and destructive cleanup.
- PF12 (P3,B3,G7) [important]: Enter submits once, Shift+Enter and in-flight IME composition do not, an unsendable composer cannot submit, Stop replaces Send and cannot double-fire while stopping, capture is offered only for an image transport and blocked during a run; draft ACK/rejection stays in `tests/agent/draft-state.test.mjs` | Bun component interaction `tests/agent/agent-composer.test.tsx` | `iter/pr`.
- PF14 (B2,B7,G3/G5/G17) [important]: one effective stage/radius/logo duration (Fluid 420 / Subtle 300 / Reduced 0), 170ms height-only cap, stable host across navigation, active-only natural measurement without 8px jumps, physical-pixel normalization, latest-frame ordering, stale revision/ACK rejection and draft-preserving Retry | Bun `tests/shell/shell-motion.test.mjs`, `tests/shell/shell-transition-race.test.tsx`, `tests/shell/shell-interaction.test.tsx`; Rust `shell::notch::tests` validates bounds/revision/sequence and real GDI tests preserve curve fringe at 100/150/200% | `iter/pr`; `node tests/e2e/transitions-native.mjs` covers real WebDriver hover/click route transitions, stage/native-frame containment, transparent wrappers, per-frame main/stage size agreement and settled stage/main edge alignment at the observed WebView scale, settings tabs and floating/attached placement on Windows; opt-in `OTTO_E2E_CAPTURE=1` saves private local keyframe PNGs. the existing Win32 `shell-native.ps1` acceptance also checks settled region shape, physical DPI geometry, click-through at floating and attached corners, foreground and capture exclusion in the native CI job; DWM flicker, physical-pixel antialiasing, frame pacing and reduced-motion remain `release` acceptance.
- `merge`: review actual changed invariants and exact-SHA proof; never call unverified boundaries green.
- `release`: once per release candidate, NSIS startup, genuine Windows CLI/capture/session recovery and process cleanup; one exploratory acceptance pass. Live provider authentication and OS semantics are not proven by mocked unit tests.
## Release
- On every merge/push to `master`, the Windows `release` workflow uses the same `windows-2022` host as the native PR gate, automatically plans a SemVer version, verifies frontend/Rust and native P8 E2E on Windows, builds one NSIS installer and publishes a **stable** GitHub Release (`--latest`, or `--prerelease` only when explicitly requested via `workflow_dispatch`) with SHA-256 checksum and curated `CHANGELOG.md` release notes. Only successful required steps publish.
- Versions follow Semantic Versioning 2.0.0 from immutable reachable `vX.Y.Z` Git tags and aligned source manifests (`package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, starting GA at `1.0.0`): breaking change (`!` or `BREAKING CHANGE:`) -> MAJOR on `>= 1.0.0` (MINOR on `0.x`); `feat` -> MINOR; `fix`/`perf`/`revert` or unknown commit -> PATCH; docs/chore/ci/build/test/refactor/style alone -> no new release. When the aligned manifest baseline is explicitly bumped above the latest reachable tag (for example `1.0.0` above `v0.3.1`) and that tag does not yet exist, the first user-facing merge publishes that exact baseline version. Highest change since the prior tag wins.
- Release workflow stamps the planned app version into the Tauri configuration **only in the checkout**. The tagged `master` SHA, locked dependency inputs (`bun.lock`, `src-tauri/Cargo.lock`), CI version stamp, `CHANGELOG.md` entry, and immutable installer checksum identify the release. No bot commits or recursive workflows.
- Bun install is frozen (`--frozen-lockfile`) and Cargo checks use `--locked`; check, full critical frontend tests, Rustfmt, Cargo check/test, Clippy, and native P8 E2E must pass before bundling. Unsuccessful runs do not publish. Prevent tag reuse, concurrent publication and unverifiable installer output.
- Tauri updater artifacts are minisign-signed with `TAURI_SIGNING_PRIVATE_KEY` for in-app update verification. The updater reads `latest.json` from the dedicated `updates` branch (written only after an immutable GitHub Release is published) on launch and every six hours, and Settings → General offers user-triggered quiet installation in NSIS current-user scope. Windows Authenticode code signing for SmartScreen remains optional/external until a signing certificate is provisioned.
- Recovery preserves known-good compatible installers; an immutable published version is never repointed or deleted. Fixes ship via roll-forward (a new higher version); reverting binaries alone does not reverse provider-side actions or local state.

## Assumptions / Risks
- A7 [non-blocking]: Q1/Q2/Q6 numerical budgets and observation window are undefined pending representative Windows baseline/task run; no fake SLO.
- A8 [non-blocking]: current scope uses 19 supported local CLI adapters, native provider settings, and PATH-based detection (with live Windows environment refresh); no direct model API/Ollama/cloud gateway, dynamic plugin loader, cross-session memory DB, coding workspace picker, multi-agent orchestration, or multi-OS parity.
- Risks/trade-offs (top 3): (1) CLI protocol variance across 19 engines for persistent sessions, image flags, and structured permission denial replies; (2) owned process-tree/cancel safety and Windows multi-DPI Region Snip / dual-hotkey contention; (3) WebView2 rendering/resource cost versus faster React UI iteration.
