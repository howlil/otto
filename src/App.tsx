import { useCallback, useEffect, useRef, useState } from "react";
import { ShellView } from "./AppView";
import { agentStatusLabel, resolveAgentSurface, useAgent } from "./features/agent";
import { resolveSurface, useNotchShell } from "./features/shell";
import { setNotchSurface } from "./platform/tauri";
import type { AgentSnapshot, ProviderReadiness } from "./platform/tauri";

function agentHomeSubtitle(
  snapshot: AgentSnapshot,
  readiness: ProviderReadiness,
  error: string | null,
) {
  if (error) return "Connection issue";
  if (snapshot.status !== "idle") return agentStatusLabel(snapshot.status, readiness.status);
  if (readiness.status === "checking")
    return `Checking ${snapshot.provider === "pi" ? "Pi" : snapshot.provider === "agy" ? "Agy" : "Codex"}`;
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
  const agent = useAgent();
  const [surfaceError, setSurfaceError] = useState<string | null>(null);
  const [agentContentHeight, setAgentContentHeight] = useState(170);
  const onAgentMeasured = useCallback((height: number) => {
    const bounded = Math.max(170, Math.min(610, Math.ceil(height)));
    setAgentContentHeight((current) => (Math.abs(current - bounded) > 2 ? bounded : current));
  }, []);
  const shell = useNotchShell();
  const { page, expanded, prefs, reducedMotion, isAgent, setEventMotion } = shell;

  const surface = resolveSurface({
    expanded,
    isAgent,
    page,
    agentSurface: resolveAgentSurface(agent.snapshot, agent.installed, agent.error),
  });
  const agentHomeCopy = agentHomeSubtitle(agent.snapshot, agent.readiness, agent.error);
  const artProps = {
    parallax: prefs.parallax,
    reduced: reducedMotion || prefs.motion === "reduced",
    amount: prefs.motion === "gentle" ? 2 : 5,
    tilt: prefs.tilt,
    gradient: prefs.gradient,
  };

  const previousSurface = useRef<string | null>(null);
  const measuredHeight = expanded && page === "agent" ? agentContentHeight : undefined;
  useEffect(() => {
    let active = true;
    const animate = !reducedMotion && previousSurface.current !== surface;
    previousSurface.current = surface;
    void setNotchSurface(surface, prefs.topOffset, animate, measuredHeight)
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
      onAgentMeasured={onAgentMeasured}
    />
  );
}
