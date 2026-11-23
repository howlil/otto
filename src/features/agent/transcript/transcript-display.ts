import { providerIssue, providerIssueTitle } from "../model/status";
import type { AgentTranscriptModel } from "../model/view-model";

function resolveTranscriptIssue(agent: AgentTranscriptModel) {
  const { snapshot, readiness, error, errorKind } = agent;
  const runFailure = snapshot.status === "failed" ? snapshot.error : null;
  const displayedErrorKind = errorKind ?? (runFailure ? "request" : null);
  const issueTitle =
    displayedErrorKind === "connection"
      ? "Otto connection unavailable"
      : displayedErrorKind === "request"
        ? "Request failed"
        : providerIssueTitle(readiness);
  const captureFailure =
    snapshot.capture.phase === "failed"
      ? (snapshot.capture.error ?? "Capture could not be completed.")
      : null;
  const issue = providerIssue(readiness, captureFailure ? null : error || runFailure);
  return { displayedErrorKind, issueTitle, captureFailure, issue };
}

export function resolveTranscriptDisplay(agent: AgentTranscriptModel) {
  const { snapshot, readiness, draft, captureBusy, busy } = agent;
  const stagedCapture = snapshot.capture.staged ?? null;
  const queuedFollowup = snapshot.queuedFollowup ?? null;
  const issues = resolveTranscriptIssue(agent);
  const canAct = !busy && !captureBusy && readiness.status === "ready";
  const canSend = canAct && (draft.trim().length > 0 || stagedCapture !== null);
  const canQueue =
    busy &&
    snapshot.status !== "stopping" &&
    !captureBusy &&
    readiness.status === "ready" &&
    draft.trim().length > 0;
  const canShowIntro =
    snapshot.messages.length === 0 &&
    snapshot.status === "idle" &&
    !issues.issue &&
    !issues.captureFailure &&
    !stagedCapture;
  const showOnboarding =
    Boolean(agent.onboardingOpen) || (Boolean(agent.onboardingPending) && canShowIntro);
  const showEmptyState = !showOnboarding && canShowIntro && canAct;
  return {
    stagedCapture,
    queuedFollowup,
    ...issues,
    canAct,
    canSend,
    canQueue,
    showOnboarding,
    showEmptyState,
  };
}
