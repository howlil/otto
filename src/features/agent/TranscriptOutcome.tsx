import { Text } from "../../shared/ui";
import type { AgentSnapshot } from "../../platform/tauri";
import { AgentErrorNotice } from "./AgentErrorNotice";
import type { AgentTranscriptModel } from "./view-model";

export function TranscriptOutcome({
  snapshot,
  issue,
  issueTitle,
  errorKind,
  retryConnection,
  refreshProvider,
  clearError,
}: {
  snapshot: AgentSnapshot;
  issue: string;
  issueTitle: string;
  errorKind: AgentTranscriptModel["errorKind"];
  retryConnection: AgentTranscriptModel["retryConnection"];
  refreshProvider: AgentTranscriptModel["refreshProvider"];
  clearError: AgentTranscriptModel["clearError"];
}) {
  return (
    <>
      {snapshot.status === "stopped" && (
        <Text as="p" variant="meta" className="m-0 text-otto-text-subtle">
          Request stopped
        </Text>
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
    </>
  );
}
