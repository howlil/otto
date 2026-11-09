import { useCallback, useEffect, useRef, useState } from "react";
import { ShellView } from "./AppView";
import {
  agentStatusLabel,
  capturePhaseLabel,
  resolveAgentSurface,
  useAgent,
} from "./features/agent";
import { useFocusTimer } from "./features/focus";
import { mediaHomeSubtitle, useMusic } from "./features/music";
import { shouldPresentOsEvent, useOsEvents } from "./features/os-events";
import {
  morphDuration,
  notchGutter,
  notchShape,
  resolveSurface,
  updateMeasuredHeights,
  useAppUpdate,
  useNotchShell,
  useNotchSurfaceSync,
} from "./features/shell";
import type { AgentSnapshot, NotchPlacement, ProviderReadiness } from "./platform/tauri";

function agentHomeSubtitle(
  snapshot: AgentSnapshot,
  readiness: ProviderReadiness,
  error: string | null,
) {
  if (snapshot.capture.phase !== "idle") return capturePhaseLabel(snapshot.capture.phase);
  if (error) return "Connection issue";
  if (snapshot.status !== "idle") return agentStatusLabel(snapshot.status, readiness.status);
  if (readiness.status === "checking") return "Open Agent to check";
  if (readiness.status !== "ready") return "Setup required";
  return snapshot.messages.length > 0 ? "Continue session" : "Ask your CLI";
}

function motionCue(status: string): string | null {
  switch (status) {
    case "completed":
      return "otto-completed";
    case "failed":
      return "otto-failed";
    default:
      return null;
  }
}

const ACTIVE_RUN = new Set(["starting", "streaming", "stopping"]);

export default function App() {
  const shell = useNotchShell();
  const osEvents = useOsEvents(shell.prefs.osEventsEnabled);
  const agent = useAgent(shell.expanded && shell.isAgent);
  const music = useMusic();
  const focus = useFocusTimer();
  const [surfaceError, setSurfaceError] = useState<string | null>(null);
  const [contentHeights, setContentHeights] = useState<Record<string, number>>({});
  const appUpdate = useAppUpdate();
  const { page, expanded, prefs, reducedMotion, isAgent, isMusic, setEventMotion } = shell;
  const onContentMeasured = useCallback(
    (height: number) => {
      setContentHeights((current) => updateMeasuredHeights(current, page, height));
    },
    [page],
  );

  const runActive = ACTIVE_RUN.has(agent.snapshot.status);
  const osEventVisible = shouldPresentOsEvent(expanded, runActive, osEvents.event);
  useEffect(() => {
    shell.setHoverEnabled(!osEvents.event);
  }, [osEvents.event, shell.setHoverEnabled]);
  useEffect(() => {
    if (osEvents.event && !osEventVisible) osEvents.dismiss();
  }, [osEvents.event, osEvents.dismiss, osEventVisible]);

  const surface = resolveSurface({
    expanded,
    isAgent,
    isMusic,
    page,
    agentSurface: resolveAgentSurface(agent.snapshot, agent.installed, agent.error),
    osEvent: osEventVisible,
  });
  const agentHomeCopy = agentHomeSubtitle(agent.snapshot, agent.readiness, agent.error);
  const artProps = {
    tilt: prefs.tilt,
    gradient: prefs.gradient,
  };

  const measuredHeight =
    expanded && (page === "agent" || page === "agent-settings" || page === "global-settings")
      ? contentHeights[page]
      : undefined;
  const requestedShape = notchShape(shell.placement.requested, expanded);
  const gutter = notchGutter(notchShape(shell.placement.applied, expanded));
  const onSurfaceObserved = useCallback(
    (observed: NotchPlacement) => {
      setSurfaceError(null);
      shell.syncPlacement(observed);
    },
    [shell.syncPlacement],
  );
  const onSurfaceError = useCallback((message: string) => setSurfaceError(message), []);
  const {
    size: surfaceSize,
    nativeSize,
    morphMs,
    stageRef,
  } = useNotchSurfaceSync({
    surface,
    shape: requestedShape,
    topOffset: prefs.topOffset,
    measuredHeight,
    reducedMotion,
    durationMs: morphDuration(prefs.motion),
    attempt: shell.placement.attempt,
    onObserved: onSurfaceObserved,
    onError: onSurfaceError,
  });

  const lastStatus = useRef(agent.snapshot.status);
  useEffect(() => {
    const previous = lastStatus.current;
    const current = agent.snapshot.status;
    lastStatus.current = current;
    if (previous === current) return;
    setEventMotion("");
    const cue = motionCue(current);
    if (!cue) return;
    setEventMotion(cue);
    const timer = setTimeout(() => setEventMotion(""), 460);
    return () => clearTimeout(timer);
  }, [agent.snapshot.status, setEventMotion]);

  return (
    <ShellView
      agent={agent}
      music={music}
      focus={focus}
      shell={shell}
      surfaceError={surfaceError}
      agentHomeCopy={agentHomeCopy}
      musicHomeCopy={mediaHomeSubtitle(music.snapshot)}
      artProps={artProps}
      gutter={gutter}
      size={surfaceSize}
      nativeSize={nativeSize}
      morphMs={morphMs}
      stageRef={stageRef}
      onContentMeasured={onContentMeasured}
      appUpdate={appUpdate}
      osEvent={osEventVisible ? osEvents.event : null}
      onDismissOsEvent={osEvents.dismiss}
    />
  );
}
