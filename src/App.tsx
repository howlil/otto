import { useCallback, useEffect, useRef, useState } from "react";
import { ShellView } from "./AppView";
import {
  agentStatusLabel,
  capturePhaseLabel,
  resolveAgentSurface,
  useAgent,
} from "./features/agent";
import { resolveSurface, useAppUpdate, useNotchShell } from "./features/shell";
import {
  isContentResize,
  shouldAnimateNotch,
  updateMeasuredHeights,
  type NotchGeometry,
} from "./features/shell/motion";
import { setNotchSurface } from "./platform/tauri";
import type { AgentSnapshot, ProviderReadiness } from "./platform/tauri";

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
    case "approvalRequired":
      return "otto-nudge";
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
  const { page, expanded, prefs, reducedMotion, isAgent, setEventMotion } = shell;
  const onContentMeasured = useCallback(
    (height: number) => {
      setContentHeights((current) => updateMeasuredHeights(current, page, height));
    },
    [page],
  );

  const surface = resolveSurface({
    expanded,
    isAgent,
    page,
    agentSurface: resolveAgentSurface(agent.snapshot, agent.installed, agent.error),
  });
  const agentHomeCopy = agentHomeSubtitle(agent.snapshot, agent.readiness, agent.error);
  const artProps = {
    tilt: prefs.tilt,
    gradient: prefs.gradient,
  };

  const previousGeometry = useRef<NotchGeometry | null>(null);
  const measuredHeight =
    expanded && (page === "agent" || page === "agent-settings" || page === "global-settings")
      ? contentHeights[page]
      : undefined;
  useEffect(() => {
    let active = true;
    const nextGeometry: NotchGeometry = { surface, height: measuredHeight };
    const animate = shouldAnimateNotch(previousGeometry.current, nextGeometry, reducedMotion);
    const contentOnly = isContentResize(previousGeometry.current, nextGeometry);
    previousGeometry.current = nextGeometry;
    void setNotchSurface(surface, prefs.topOffset, animate, measuredHeight, contentOnly)
      .then(() => {
        if (active) setSurfaceError(null);
      })
      .catch(() => {
        if (active) setSurfaceError("Notch resizing is unavailable in this Windows session.");
      });
    return () => {
      active = false;
    };
  }, [surface, prefs.topOffset, reducedMotion, measuredHeight]);

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
      shell={shell}
      surfaceError={surfaceError}
      agentHomeCopy={agentHomeCopy}
      artProps={artProps}
      onContentMeasured={onContentMeasured}
      appUpdate={appUpdate}
    />
  );
}
