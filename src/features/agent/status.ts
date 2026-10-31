import type { AgentStatus } from "../../platform/tauri";

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

export function agentStatusLabel(status: AgentStatus): string {
  return agentStatusLabels[status] ?? status;
}
