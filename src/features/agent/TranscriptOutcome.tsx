import { Text } from "../../shared/ui";
import { CopyAnswerButton } from "./CopyAnswerButton";
import type { AgentSnapshot } from "../../platform/tauri";
import { AgentErrorNotice } from "./AgentErrorNotice";
import { ApprovalCard } from "./ApprovalCard";
import type { AgentTranscriptModel } from "./view-model";

export function TranscriptOutcome({
  approval,
  approvalPending,
  denied,
  onDenied,
  decide,
  snapshot,
  issue,
  issueTitle,
  errorKind,
  retryConnection,
  refreshProvider,
  clearError,
  lastAnswer,
}: {
  approval: AgentTranscriptModel["snapshot"]["approval"];
  approvalPending: boolean;
  denied: boolean;
  onDenied: () => void;
  decide: AgentTranscriptModel["decide"];
  snapshot: AgentSnapshot;
  issue: string;
  issueTitle: string;
  errorKind: AgentTranscriptModel["errorKind"];
  retryConnection: AgentTranscriptModel["retryConnection"];
  refreshProvider: AgentTranscriptModel["refreshProvider"];
  clearError: AgentTranscriptModel["clearError"];
  lastAnswer: string | null;
}) {
  return (
    <>
      {approvalPending && approval && (
        <ApprovalCard
          key={approval.approvalId}
          approval={approval}
          onDecide={async (decision) => {
            if ((await decide(approval.approvalId, decision)) && decision === "deny") onDenied();
          }}
        />
      )}
      {snapshot.status === "stopped" && (
        <Text as="p" variant="meta" className="m-0 text-otto-text-subtle">
          {denied ? "Approval denied. This action was not authorized." : "Request stopped"}
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
      {snapshot.status === "completed" && lastAnswer && (
        <div>
          <CopyAnswerButton value={lastAnswer} />
        </div>
      )}
    </>
  );
}
