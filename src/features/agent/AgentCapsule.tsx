import type { AgentSnapshot } from "../../platform/tauri";
import { Bars, Icon } from "../../shared/ui";
import { compactDetail, compactLabel } from "./surface";

// The agent's Compact capsule. It only renders observed state; it never
// invents progress or completion.
export function AgentCapsule({
  snapshot,
  installed,
  buttonRef,
  onOpen,
}: {
  snapshot: AgentSnapshot;
  installed: boolean | null;
  buttonRef: React.Ref<HTMLButtonElement>;
  onOpen: () => void;
}) {
  const thinking = ["starting", "streaming"].includes(snapshot.status);
  return (
    <button
      ref={buttonRef}
      className="otto-compact is-agent flex items-center justify-center w-full h-full bg-transparent text-left"
      type="button"
      onClick={onOpen}
      aria-label="Open Agent"
    >
      <span className="otto-agent-avatar grid place-items-center shrink-0 rounded-full">
        <Icon name="terminal" size={16} />
      </span>
      <span className="otto-compact-copy min-w-0 flex-1">
        <strong>{compactLabel(snapshot, installed)}</strong>
        <small>{compactDetail(snapshot, installed)}</small>
      </span>
      {snapshot.status === "approvalRequired" ? (
        <span className="otto-compact-marker warn" role="status" aria-label="Approval needed">
          <Icon name="alert" size={14} strokeWidth={1.9} />
        </span>
      ) : installed === false || snapshot.status === "failed" ? (
        <span className="otto-compact-marker error" role="status" aria-label="Codex unavailable">
          <Icon name="alert" size={14} strokeWidth={1.9} />
        </span>
      ) : thinking ? (
        <Bars />
      ) : snapshot.status === "completed" ? (
        <span className="otto-compact-mark">✓</span>
      ) : null}
    </button>
  );
}
