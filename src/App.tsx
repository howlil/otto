import { useEffect, useRef, useState } from "react";
import { ShellView } from "./AppView";
import { agentStatusLabel, resolveAgentSurface, useAgent } from "./features/agent";
import { resolveSurface, useNotchShell } from "./features/shell";
import { setNotchSurface } from "./platform/tauri";
import type { AgentSnapshot, ProviderReadiness } from "./platform/tauri";

function hasAmbientAgent(isAgent: boolean, snapshot: AgentSnapshot, error: string | null) {
  return isAgent || snapshot.status !== "idle" || Boolean(error) || snapshot.messages.length > 0;
}

function agentHomeSubtitle(
  snapshot: AgentSnapshot,
  readiness: ProviderReadiness,
  error: string | null,
) {
  if (error) return "Connection issue";
  if (snapshot.status !== "idle") return agentStatusLabel(snapshot.status, readiness.status);
  if (readiness.status === "checking") return "Checking Codex";
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
  const shell = useNotchShell();
  const { page, expanded, prefs, reducedMotion, isAgent, setEventMotion } = shell;

  const surface = resolveSurface({
    expanded,
    isAgent,
    page,
    agentSurface: resolveAgentSurface(agent.snapshot, agent.installed, agent.error),
  });
  const ambientAgent = hasAmbientAgent(isAgent, agent.snapshot, agent.error);
  const agentHomeCopy = agentHomeSubtitle(agent.snapshot, agent.readiness, agent.error);
  const artProps = {
    parallax: prefs.parallax,
    reduced: reducedMotion || prefs.motion === "reduced",
    amount: prefs.motion === "gentle" ? 2 : 5,
    tilt: prefs.tilt,
    gradient: prefs.gradient,
  };

  useEffect(() => {
    let active = true;
    void setNotchSurface(surface, prefs.topOffset, !reducedMotion)
      .then(() => {
        if (active) setSurfaceError(null);
      })
      .catch(() => {
        if (active) setSurfaceError("Notch resizing is unavailable in this Windows session.");
      });
    return () => {
      active = false;
    };
  }, [surface, prefs.topOffset, reducedMotion]);

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
      ambientAgent={ambientAgent}
      agentHomeCopy={agentHomeCopy}
      artProps={artProps}
    />
  );
}
