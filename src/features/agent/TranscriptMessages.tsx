import { Text } from "../../shared/ui";
import type { AgentSnapshot } from "../../platform/tauri";
import { Bars } from "./AgentControls";
import { agentIsWorking } from "./status";
import { MessageContent } from "./MessageContent";
import { CopyAnswerButton } from "./CopyAnswerButton";
import { promptPresets } from "./conversation";

export function TranscriptMessages({
  snapshot,
  busy,
  activeMatch,
  matching,
  onPreset,
  onQuote,
}: {
  snapshot: AgentSnapshot;
  busy: boolean;
  activeMatch: number | null;
  matching: number[];
  onPreset: (prompt: string) => void;
  onQuote: (answer: string) => void;
}) {
  return (
    <>
      {snapshot.messages.length === 0 && !busy && (
        <div className="space-y-2">
          <Text as="p" variant="body-compact" className="m-0 text-otto-line-muted">
            Ask {snapshot.provider === "pi" ? "Pi" : snapshot.provider === "agy" ? "Agy" : "Codex"}{" "}
            about your current task
          </Text>
          <div className="flex flex-wrap gap-1.5">
            {promptPresets.map((preset) => (
              <button
                type="button"
                key={preset.label}
                onClick={() => onPreset(preset.prompt)}
                className="rounded-full border border-otto-line-mid bg-otto-control-deep px-3 py-1.5 text-otto-xs text-otto-text-secondary hover:text-otto-text"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {snapshot.messages.map((message, index) => (
        <div
          data-conversation-message
          key={message.id}
          className={
            matching.includes(index)
              ? "min-w-0 rounded-otto-control outline outline-1 outline-otto-line-hover"
              : "min-w-0"
          }
          data-current-match={activeMatch === index || undefined}
        >
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
