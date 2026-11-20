import { useCallback, useEffect, useRef, useState } from "react";
import { ShellView } from "./AppView";
import { resolveAgentSurface, useAgent } from "../features/agent";
import {
  morphDuration,
  notchGutter,
  notchShape,
  resolveSurface,
  updateMeasuredHeights,
  useAppUpdate,
  useNotchShell,
  useNotchSurfaceSync,
} from "../features/shell";
import type { NotchPlacement } from "../platform/tauri";

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

export default function App() {
  const shell = useNotchShell();
  const agent = useAgent(shell.expanded && shell.isAgent);
  const [surfaceError, setSurfaceError] = useState<string | null>(null);
  const [contentHeights, setContentHeights] = useState<Record<string, number>>({});
  const appUpdate = useAppUpdate();
  const { page, expanded, prefs, reducedMotion, setEventMotion } = shell;
  const onContentMeasured = useCallback(
    (height: number) => {
      setContentHeights((current) => updateMeasuredHeights(current, page, height));
    },
    [page],
  );

  const resolvedSurface = resolveSurface({
    expanded,
    page,
    agentSurface: resolveAgentSurface(agent.snapshot, agent.installed, agent.error),
  });
  const surface = resolvedSurface;

  const measuredHeight =
    expanded && (page === "agent" || page === "settings") ? contentHeights[page] : undefined;
  const requestedShape = notchShape(
    shell.ottoOs ? "floating" : shell.placement.requested,
    expanded,
  );
  const onSurfaceObserved = useCallback(
    (observed: NotchPlacement) => {
      setSurfaceError(null);
      shell.syncPlacement(observed);
    },
    [shell.syncPlacement],
  );
  const onSurfaceError = useCallback((message: string) => setSurfaceError(message), []);
  const onPanelMoved = useCallback(
    (position: { x: number; y: number }) => {
      if (!shell.isPanelDragging()) return;
      shell.notePanelMove();
      shell.setPanelPosition(position);
    },
    [shell.isPanelDragging, shell.notePanelMove, shell.setPanelPosition],
  );
  const {
    size: surfaceSize,
    nativeSize,
    scale: surfaceScale,
    morphMs,
    stageRef,
    placement: surfacePlacement,
    recovery,
    sizingHost,
  } = useNotchSurfaceSync({
    surface,
    shape: requestedShape,
    topOffset: prefs.topOffset,
    position: prefs.position,
    positionReset: shell.positionReset,
    measuredHeight,
    reducedMotion,
    durationMs: morphDuration(prefs.motion),
    attempt: shell.placement.attempt,
    onObserved: onSurfaceObserved,
    onError: onSurfaceError,
    onMoved: onPanelMoved,
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

  const lastStagedId = useRef<number | null>(agent.snapshot.capture.staged?.id ?? null);
  useEffect(() => {
    const nextId = agent.snapshot.capture.staged?.id ?? null;
    const previousId = lastStagedId.current;
    lastStagedId.current = nextId;
    if (nextId !== null && nextId !== previousId && !expanded) {
      shell.open("agent", true);
    }
  }, [agent.snapshot.capture.staged?.id, expanded, shell.open]);

  return (
    <ShellView
      agent={agent}
      shell={shell}
      surfaceError={surfaceError}
      gutter={notchGutter(notchShape(surfacePlacement, expanded))}
      placement={surfacePlacement}
      recovery={recovery}
      sizingHost={sizingHost}
      onRetrySurface={() => {
        setSurfaceError(null);
        shell.placement.retry();
      }}
      size={surfaceSize}
      nativeSize={nativeSize}
      scale={surfaceScale}
      morphMs={morphMs}
      stageRef={stageRef}
      onContentMeasured={onContentMeasured}
      appUpdate={appUpdate}
    />
  );
}
