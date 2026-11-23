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
  useIdleMemoryMode,
  useNotchShell,
  useNotchSurfaceSync,
  type HostSettleRequest,
  type PanelPosition,
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
  const dragEndRef = useRef<(position: PanelPosition) => void>(() => {});
  const onDragEnd = useCallback((position: PanelPosition) => dragEndRef.current(position), []);
  const shell = useNotchShell({ onDragEnd });
  const agent = useAgent(shell.expanded && shell.isAgent, shell.pinned && shell.isAgent);
  const [surfaceError, setSurfaceError] = useState<string | null>(null);
  const [contentHeights, setContentHeights] = useState<Record<string, number>>({});
  const [pendingSettle, setPendingSettle] = useState<HostSettleRequest | null>(null);
  const appUpdate = useAppUpdate(
    shell.expanded && shell.page === "settings" && shell.settingsTab === "general",
  );
  useIdleMemoryMode(shell.expanded || agent.busy || agent.captureBusy);
  const { page, expanded, prefs, reducedMotion, setEventMotion } = shell;
  const onContentMeasured = useCallback(
    (height: number) =>
      setContentHeights((current) => updateMeasuredHeights(current, page, height)),
    [page],
  );
  const surface = resolveSurface({
    expanded,
    page,
    agentSurface: resolveAgentSurface(agent.snapshot, agent.installed, agent.error),
    compactCircle: shell.compactCircle,
  });

  const measuredHeight =
    expanded && (page === "agent" || page === "settings") ? contentHeights[page] : undefined;
  const requestedShape = notchShape(
    shell.compactCircle || shell.ottoOsDetected ? "floating" : shell.placement.requested,
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
    anchor: surfaceAnchor,
    recovery,
    sizingHost,
  } = useNotchSurfaceSync({
    surface,
    shape: requestedShape,
    topOffset: prefs.topOffset,
    position: prefs.position,
    positionReset: shell.positionReset,
    dockWithOttoOs: prefs.dockWithOttoOs,
    compactCircle: shell.compactCircle,
    settle: pendingSettle,
    measuredHeight,
    reducedMotion,
    durationMs: morphDuration(prefs.motion),
    attempt: shell.placement.attempt,
    onObserved: onSurfaceObserved,
    onError: onSurfaceError,
    onMoved: onPanelMoved,
    onSettled: shell.setPanelPosition,
  });

  dragEndRef.current = (position: PanelPosition) => {
    const rect = stageRef.current?.getBoundingClientRect();
    const surfaceRect =
      rect && rect.width > 0 && rect.height > 0
        ? {
            x: Math.round(rect.left * surfaceScale),
            y: Math.round(rect.top * surfaceScale),
            width: Math.max(1, Math.round(rect.width * surfaceScale)),
            height: Math.max(1, Math.round(rect.height * surfaceScale)),
          }
        : null;
    shell.setPanelPosition(position);
    setPendingSettle((current) => ({
      id: (current?.id ?? 0) + 1,
      position,
      surfaceRect,
    }));
  };

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
      anchor={surfaceAnchor}
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
