import { Button, Text } from "../../../shared/ui";
import type { AgentSnapshot } from "../../../platform/tauri";
import { AgentErrorNotice } from "../conversation/AgentErrorNotice";
import type { AgentTranscriptModel } from "../model/view-model";

export function TranscriptOutcome({
  snapshot,
  canRetry = false,
  onRetry,
  issue,
  issueTitle,
  errorKind,
  retryConnection,
  refreshProvider,
  clearError,
}: {
  snapshot: AgentSnapshot;
  canRetry?: boolean;
  onRetry?: () => Promise<void>;
  issue: string;
  issueTitle: string;
  errorKind: AgentTranscriptModel["errorKind"];
  retryConnection: AgentTranscriptModel["retryConnection"];
  refreshProvider: AgentTranscriptModel["refreshProvider"];
  clearError: AgentTranscriptModel["clearError"];
}) {
  const lastMessage = snapshot.messages.at(-1);
  const hasVisibleAssistantAnswer =
    lastMessage?.role === "assistant" && lastMessage.text.trim().length > 0;
  const hasUserPrompt = snapshot.messages.some((message) => message.role === "user");
  const showFallbackRetry =
    canRetry &&
    Boolean(onRetry) &&
    hasUserPrompt &&
    !hasVisibleAssistantAnswer &&
    (snapshot.status === "stopped" || snapshot.status === "failed");

  return (
    <>
      {snapshot.status === "stopped" && (
        <div className="flex items-center justify-between gap-2">
          <Text as="p" variant="meta" className="m-0 text-otto-text-subtle">
            Request stopped
          </Text>
          {showFallbackRetry && (
            <Button variant="quiet" size="xs" onClick={() => void onRetry?.()}>
              Retry
            </Button>
          )}
        </div>
      )}
      {issue && (
        <AgentErrorNotice
          issue={issue}
          issueTitle={issueTitle}
          errorKind={errorKind}
          retryConnection={retryConnection}
          refreshProvider={refreshProvider}
          clearError={clearError}
        />
      )}
      {showFallbackRetry && snapshot.status === "failed" && (
        <div>
          <Button variant="secondary" size="xs" onClick={() => void onRetry?.()}>
            Retry last question
          </Button>
        </div>
      )}
    </>
  );
}
