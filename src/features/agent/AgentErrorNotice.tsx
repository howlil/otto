import { StatusMessage } from "../../shared/ui";
import type { AgentErrorKind } from "./useAgent";

export function AgentErrorNotice({
  issue,
  issueTitle,
  errorKind,
  retryConnection,
  refreshProvider,
  clearError,
}: {
  issue: string;
  issueTitle: string;
  errorKind: AgentErrorKind;
  retryConnection: () => Promise<void>;
  refreshProvider: () => Promise<void>;
  clearError: () => void;
}) {
  const action =
    errorKind === "connection"
      ? { label: "Reconnect", onClick: () => void retryConnection() }
      : errorKind === "request"
        ? { label: "Dismiss", onClick: clearError }
        : { label: "Retry", onClick: () => void refreshProvider() };

  return (
    <StatusMessage
      tone="error"
      className="rounded-[11px] border border-otto-danger bg-otto-field-deep p-3 [&>div>p]:my-2 [&>div>p]:text-otto-danger-detail [&>div>strong]:text-otto-danger-copy"
      title={issueTitle}
      action={action}
    >
      {issue}
    </StatusMessage>
  );
}
