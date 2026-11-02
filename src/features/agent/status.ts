import type { AgentStatus, CapturePhase, ProviderReadiness } from "../../platform/tauri";

export const agentStatusLabels: Record<AgentStatus, string> = {
  idle: "Ready",
  starting: "Thinking",
  streaming: "Responding",
  stopping: "Stopping",
  completed: "Answer ready",
  stopped: "Stopped",
  failed: "Disconnected",
};

export function agentStatusLabel(
  status: AgentStatus,
  readiness?: ProviderReadiness["status"],
): string {
  if (status === "idle" && readiness === "checking") return "Checking";
  if (status === "idle" && readiness && readiness !== "ready") return "Setup required";
  return agentStatusLabels[status] ?? status;
}

export function providerIssue(readiness: ProviderReadiness, error: string | null): string {
  if (error) return error;
  if (readiness.status === "ready" || readiness.status === "checking") return "";
  return `${readiness.message} ${readiness.recovery}`;
}

export function providerIssueTitle(readiness: ProviderReadiness): string {
  return readiness.status === "authRequired" ? "Sign in required" : "Unavailable";
}

export function agentIsWorking(status: AgentStatus): boolean {
  return status === "starting" || status === "streaming";
}

export function captureIsWorking(phase: CapturePhase): boolean {
  return (
    phase === "preparing" ||
    phase === "capturing" ||
    phase === "submitting" ||
    phase === "analyzing"
  );
}

export function capturePhaseLabel(phase: CapturePhase): string {
  if (phase === "preparing") return "Preparing capture";
  if (phase === "capturing") return "Capturing screen";
  if (phase === "submitting") return "Sending image";
  if (phase === "analyzing") return "Analyzing screenshot";
  if (phase === "failed") return "Capture failed";
  return "Ready";
}

export function agentStatusColor(
  status: AgentStatus,
  readiness: ProviderReadiness["status"],
): string {
  if (status === "failed") return "bg-otto-danger";
  if (status === "stopping" || status === "stopped" || status === "starting")
    return "bg-otto-text-tertiary";
  if (status === "idle" && readiness !== "ready")
    return readiness === "checking" ? "bg-otto-text-tertiary" : "bg-otto-warn";
  return "bg-otto-ok";
}
