import { useEffect, useRef, useState, type FormEvent } from "react";
import { Bars, Icon, VisuallyHidden } from "../../shared/ui";
import type { AgentSnapshot } from "../../platform/tauri";
import { ApprovalCard } from "./ApprovalCard";
import type { useAgent } from "./useAgent";

type AgentController = ReturnType<typeof useAgent>;

export function AgentTranscript({
  agent,
  denied,
  approvalPending,
  onDenied,
}: {
  agent: AgentController;
  denied: boolean;
  approvalPending: boolean;
  onDenied: () => void;
}) {
  const { snapshot, readiness, draft, setDraft, error, busy, send, stop, decide, refreshProvider } =
    agent;
  const feed = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (snapshot.seq > 0 && nearBottom.current)
      feed.current?.scrollTo({ top: feed.current.scrollHeight });
  }, [snapshot.seq]);

  const canSend = !busy && readiness.status === "ready" && draft.trim().length > 0;
  const approval = snapshot.approval;
  const issue =
    error ||
    (["ready", "checking"].includes(readiness.status)
      ? ""
      : `${readiness.message} ${readiness.recovery}`);
  const lastAnswer = [...snapshot.messages]
    .reverse()
    .find((message) => message.role === "assistant" && message.text.length > 0);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSend) void send();
  };
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
        className="otto-agent-feed min-w-0 min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
        ref={feed}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        onScroll={(event) => {
          const el = event.currentTarget;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        <div className="otto-feed-stack flex min-w-0 flex-col gap-[11px]">
          {snapshot.messages.length === 0 && !busy && (
            <p className="otto-empty-agent">Ask Codex about your current task</p>
          )}
          {snapshot.messages.map((message, index) =>
            message.role === "user" ? (
              <div className="otto-question" key={message.id}>
                {message.text}
              </div>
            ) : (
              <div key={message.id} className="otto-response">
                {message.text || busy ? (
                  <>
                    {message.text}
                    {busy && index === snapshot.messages.length - 1 && (
                      <span className="otto-caret" />
                    )}
                  </>
                ) : null}
              </div>
            ),
          )}
          {busy && (
            <div className="otto-agent-activity flex items-center gap-[7px]">
              <Bars />
              {activityLabel(snapshot)}
            </div>
          )}
          {busy && snapshot.activity && (
            <div className="otto-tool">
              {snapshot.activity.kind === "fileChange" ? "Write" : "Run"} ·{" "}
              {snapshot.activity.summary}
            </div>
          )}
          {approvalPending && approval && (
            <ApprovalCard
              key={approval.approvalId}
              approval={approval}
              onDecide={async (decision) => {
                if (await decide(approval.approvalId, decision)) {
                  if (decision === "deny") onDenied();
                }
              }}
            />
          )}
          {snapshot.status === "stopped" && (
            <p className="otto-agent-hint">
              {denied ? "Approval denied. This action was not authorized." : "Request stopped"}
            </p>
          )}
          {issue && (
            <div className="otto-error-card" role="alert">
              <strong>{readiness.status === "authRequired" ? "Sign in required" : "Unavailable"}</strong>
              <p>{issue}</p>
              <button type="button" onClick={() => void refreshProvider()}>
                Retry
              </button>
            </div>
          )}
          {snapshot.status === "completed" && lastAnswer && (
            <div className="otto-response-actions">
              <button type="button" onClick={() => void copy(lastAnswer.text)}>
                <Icon name="copy" size={13} /> Copy answer
              </button>
            </div>
          )}
          {notice && (
            <p className="otto-agent-hint" role="status">
              {notice}
            </p>
          )}
        </div>
      </div>
      <div className="otto-agent-compose-wrap shrink-0">
        <form className="otto-agent-composer flex items-center gap-[5px]" onSubmit={submit}>
          <button
            type="button"
            disabled
            title="Screen capture is not available in this slice"
            className="otto-round-action grid shrink-0 place-items-center rounded-full"
          >
            <Icon name="camera" />
            <VisuallyHidden>Capture not available yet</VisuallyHidden>
          </button>
          <VisuallyHidden htmlFor="otto-prompt">Question for Codex</VisuallyHidden>
          <textarea
            id="otto-prompt"
            rows={1}
            placeholder="Ask Codex…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={busy || approvalPending}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (canSend) void send();
              }
            }}
          />
          {busy ? (
            <button
              type="button"
              title="Stop"
              className="otto-round-action primary"
              onClick={() => void stop()}
              disabled={snapshot.status === "stopping"}
            >
              <Icon name="stop" />
              <VisuallyHidden>Stop Codex</VisuallyHidden>
            </button>
          ) : (
            <button
              type="submit"
              title="Send"
              className="otto-round-action primary"
              disabled={!canSend}
            >
              <Icon name="send" />
              <VisuallyHidden>Send prompt</VisuallyHidden>
            </button>
          )}
        </form>
      </div>
    </>
  );
}

function activityLabel(snapshot: AgentSnapshot): string {
  if (snapshot.status === "starting") return "Reading context";
  if (snapshot.status === "stopping") return "Stopping request";
  if (snapshot.status === "approvalRequired") return "Waiting for your approval";
  if (snapshot.activity) {
    return snapshot.activity.kind === "fileChange" ? "Changing files" : "Inspecting workspace";
  }
  return "Writing response";
}
