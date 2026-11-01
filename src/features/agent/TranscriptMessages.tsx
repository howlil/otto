import { Text } from "../../shared/ui";
import type { AgentSnapshot } from "../../platform/tauri";
import { Bars } from "./AgentControls";
import { agentIsWorking } from "./status";
import { MessageContent } from "./MessageContent";
import { CopyAnswerButton } from "./CopyAnswerButton";

export function TranscriptMessages({
  snapshot,
  busy,
  onQuote,
}: {
  snapshot: AgentSnapshot;
  busy: boolean;
  onQuote: (answer: string) => void;
}) {
  return (
    <>
      {snapshot.messages.map((message, index) => (
        <div key={message.id} className="min-w-0">
          {message.role === "user" ? (
            <div className="ml-auto max-w-[87%] whitespace-pre-wrap rounded-[12px_12px_4px_12px] bg-otto-raised-soft px-[11px] py-[9px] text-otto-text-soft-white [overflow-wrap:anywhere]">
              <Text as="span" variant="body-compact">
                {message.text}
              </Text>
            </div>
          ) : (
            <div className="min-w-0 w-full break-words text-otto-text-soft-white">
              <MessageContent text={message.text} />
              {!busy && message.text.trim() && (
                <div className="mt-1 flex items-center gap-[7px]">
                  <CopyAnswerButton value={message.text} label="Copy" />
                  <button
                    type="button"
                    onClick={() => onQuote(message.text)}
                    className="inline-flex min-h-7 items-center rounded-md border-0 bg-transparent px-1 py-[5px] text-otto-xs text-otto-text-tertiary hover:bg-otto-control-deep hover:text-otto-text"
                  >
                    Quote
                  </button>
                </div>
              )}
              {busy && index === snapshot.messages.length - 1 && (
                <span className="ml-0.5 inline-block h-3 w-1 bg-otto-control-text motion-safe:animate-otto-caret motion-reduce:animate-none" />
              )}
            </div>
          )}
        </div>
      ))}
      {busy && (
        <div className="flex items-center gap-[7px] text-otto-text-secondary">
          {agentIsWorking(snapshot.status) && <Bars />}
          <Text as="span" variant="status">
            {activityLabel(snapshot)}
          </Text>
        </div>
      )}
      {busy && snapshot.activity && (
        <Text
          as="div"
          variant="code"
          className="rounded-otto-control border border-otto-raised-deep bg-otto-control px-[10px] py-[9px] text-otto-icon-muted [overflow-wrap:anywhere]"
        >
          {snapshot.activity.kind === "fileChange" ? "Write" : "Run"} · {snapshot.activity.summary}
        </Text>
      )}
    </>
  );
}

function activityLabel(snapshot: AgentSnapshot): string {
  if (snapshot.status === "starting") return "Reading context";
  if (snapshot.status === "stopping") return "Stopping request";
  if (snapshot.status === "approvalRequired") return "Waiting for your approval";
  if (snapshot.activity)
    return snapshot.activity.kind === "fileChange" ? "Changing files" : "Inspecting workspace";
  return "Writing response";
}
