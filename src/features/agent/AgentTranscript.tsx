import { useState } from "react";
import { AgentComposer } from "./AgentComposer";
import { providerIssue, providerIssueTitle } from "./status";
import { TranscriptMessages } from "./TranscriptMessages";
import { TranscriptOutcome } from "./TranscriptOutcome";
import type { AgentTranscriptModel } from "./view-model";
import {
  conversationAsMarkdown,
  matchingMessages,
  quoteForFollowUp,
  withPromptPreset,
} from "./conversation";
import { ConversationToolbar } from "./ConversationToolbar";
import { useTranscriptViewport } from "./useTranscriptViewport";

export function AgentTranscript({
  agent,
  denied,
  approvalPending,
  onDenied,
  onConfigureCapture,
  onCapture,
  captureActionError,
  actionsOpen,
  setActionsOpen,
  onMeasured,
}: {
  agent: AgentTranscriptModel;
  denied: boolean;
  approvalPending: boolean;
  onDenied: () => void;
  onConfigureCapture: () => void;
  onCapture: () => void;
  captureActionError: string | null;
  actionsOpen: boolean;
  setActionsOpen: (open: boolean) => void;
  onMeasured: (height: number) => void;
}) {
  const {
    snapshot,
    readiness,
    draft,
    setDraft,
    error,
    errorKind,
    busy,
    send,
    stop,
    decide,
    refreshProvider,
    retryConnection,
    clearError,
  } = agent;
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [matchCursor, setMatchCursor] = useState(0);
  const [exportError, setExportError] = useState(false);
  const matches = searchOpen ? matchingMessages(snapshot.messages, searchTerm) : [];
  const activeMatch = matches.length ? matches[matchCursor % matches.length] : null;
  const markdown = conversationAsMarkdown(snapshot.messages, snapshot.provider, snapshot.cwd);
  const { feed, composer, onFeedScroll } = useTranscriptViewport({
    onMeasured,
    searchOpen,
    exportError,
    captureActionError,
    seq: snapshot.seq,
    activeMatch,
  });

  const exportMarkdown = () => {
    if (!markdown) return;
    try {
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const workspace = snapshot.cwd.split(/[\\/]/).filter(Boolean).pop() || "conversation";
      link.download = "otto-" + workspace.replace(/[^a-z0-9_-]/gi, "-").slice(0, 50) + ".md";
      link.href = url;
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportError(false);
    } catch {
      setExportError(true);
    }
  };

  const canSend = !busy && readiness.status === "ready" && draft.trim().length > 0;
  const approval = snapshot.approval;
  const issueTitle =
    errorKind === "connection"
      ? "Otto connection unavailable"
      : errorKind === "request"
        ? "Request failed"
        : providerIssueTitle(readiness);
  const issue = providerIssue(readiness, error);
  const lastAnswer = [...snapshot.messages]
    .reverse()
    .find((message) => message.role === "assistant" && message.text.length > 0);

  return (
    <>
      <ConversationToolbar
        messageCount={snapshot.messages.length}
        actionsOpen={actionsOpen}
        setActionsOpen={setActionsOpen}
        searchOpen={searchOpen}
        searchTerm={searchTerm}
        matchCursor={matchCursor}
        matches={matches}
        markdown={markdown}
        exportError={exportError}
        exportMarkdown={exportMarkdown}
        setSearchOpen={setSearchOpen}
        setSearchTerm={setSearchTerm}
        setMatchCursor={setMatchCursor}
      />
      <div
        className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-[18px] pb-[9px] pt-[7px] [overscroll-behavior:contain] [scrollbar-width:none]"
        ref={feed}
        role="log"
        onScroll={onFeedScroll}
      >
        <div className="flex min-w-0 flex-col gap-[11px]">
          <TranscriptMessages
            snapshot={snapshot}
            busy={busy}
            matching={matches}
            activeMatch={activeMatch}
            onPreset={(prompt) => setDraft(withPromptPreset(draft, prompt))}
            onQuote={(answer) => {
              setDraft(quoteForFollowUp(answer, draft));
              document.getElementById("otto-prompt")?.focus({ preventScroll: true });
            }}
          />
          <TranscriptOutcome
            approval={approval}
            approvalPending={approvalPending}
            denied={denied}
            onDenied={onDenied}
            decide={decide}
            snapshot={snapshot}
            issue={issue}
            issueTitle={issueTitle}
            errorKind={errorKind}
            retryConnection={retryConnection}
            refreshProvider={refreshProvider}
            clearError={clearError}
            lastAnswer={lastAnswer?.text ?? null}
          />
        </div>
      </div>
      {captureActionError && (
        <div role="alert" className="mx-[18px] mb-1 text-otto-xs text-otto-danger">
          {captureActionError}{" "}
          <button type="button" className="underline" onClick={onConfigureCapture}>
            Screen Capture settings
          </button>
        </div>
      )}
      <AgentComposer
        composerRef={composer}
        imageTransport={readiness.imageTransport}
        provider={snapshot.provider}
        draft={draft}
        setDraft={setDraft}
        busy={busy}
        approvalPending={approvalPending}
        canSend={canSend}
        stopping={snapshot.status === "stopping"}
        onCapture={onCapture}
        send={send}
        stop={stop}
      />
    </>
  );
}
