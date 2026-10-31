import { Text } from "../../shared/ui";
import type { AgentSnapshot } from "../../platform/tauri";
import { Bars } from "./AgentControls";
import { agentIsWorking } from "./status";

export function TranscriptMessages({ snapshot, busy }: { snapshot: AgentSnapshot; busy: boolean }) {
  return (
    <>
      {snapshot.messages.length === 0 && !busy && (
        <Text
          as="p"
          variant="body-compact"
          className="m-0 flex h-[30px] items-center text-otto-line-muted"
        >
          Ask Codex about your current task
        </Text>
      )}
      {snapshot.messages.map((message, index) =>
        message.role === "user" ? (
          <div
            className="max-w-[87%] self-end whitespace-pre-wrap rounded-[12px_12px_4px_12px] bg-otto-raised-soft px-[11px] py-[9px] text-otto-text-soft-white [overflow-wrap:anywhere]"
            key={message.id}
          >
            <Text as="span" variant="body-compact">
              {message.text}
            </Text>
          </div>
        ) : (
          <div
            key={message.id}
            className="min-w-0 w-full break-words whitespace-pre-wrap text-otto-text-soft-white"
          >
            <Text as="span" variant="body">
              {message.text || busy ? (
                <>
                  {message.text}
                  {busy && index === snapshot.messages.length - 1 && (
                    <span className="ml-0.5 inline-block h-3 w-1 align-[-1px] bg-otto-control-text motion-safe:animate-otto-caret motion-reduce:animate-none" />
                  )}
                </>
              ) : null}
            </Text>
          </div>
        ),
      )}
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
  if (snapshot.activity) {
    return snapshot.activity.kind === "fileChange" ? "Changing files" : "Inspecting workspace";
  }
  return "Writing response";
}
