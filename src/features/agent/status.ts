import type { AgentStatus, ProviderReadiness } from "../../platform/tauri";

// One source of truth for status copy shared by the expanded panel and the
// compact island, so the raw enum value is never shown to the user.
export const agentStatusLabels: Record<AgentStatus, string> = {
  idle: "Ready",
  starting: "Thinking",
  streaming: "Responding",
  approvalRequired: "Approval needed",
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
