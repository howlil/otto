import { useEffect, useRef, useState } from "react";
import { AgentComposer } from "./AgentComposer";
import { providerIssue, providerIssueTitle } from "./status";
import { TranscriptMessages } from "./TranscriptMessages";
import { TranscriptOutcome } from "./TranscriptOutcome";
import type { AgentTranscriptModel } from "./view-model";

export function AgentTranscript({
  agent,
  denied,
  approvalPending,
  onDenied,
}: {
  agent: AgentTranscriptModel;
  denied: boolean;
  approvalPending: boolean;
  onDenied: () => void;
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
  const feed = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (snapshot.seq > 0 && nearBottom.current)
      feed.current?.scrollTo({ top: feed.current.scrollHeight });
  }, [snapshot.seq]);

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

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("Answer copied");
    } catch {
      setNotice("Clipboard is unavailable.");
    }
  };

  return (
    <>
      <div
        className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-[18px] pb-[9px] pt-[7px] [overscroll-behavior:contain] [scrollbar-width:none]"
        ref={feed}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        onScroll={(event) => {
          const el = event.currentTarget;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        <div className="flex min-w-0 flex-col gap-[11px]">
          <TranscriptMessages snapshot={snapshot} busy={busy} />
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
            copy={copy}
            notice={notice}
          />
        </div>
      </div>
      <AgentComposer
        draft={draft}
        setDraft={setDraft}
        busy={busy}
        approvalPending={approvalPending}
        canSend={canSend}
        stopping={snapshot.status === "stopping"}
        send={send}
        stop={stop}
      />
    </>
  );
}
