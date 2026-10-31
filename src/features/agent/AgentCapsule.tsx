import type { AgentSnapshot, ProviderReadiness } from "../../platform/tauri";
import { Bars, Icon, VisuallyHidden } from "../../shared/ui";
import { compactDetail, compactLabel } from "./surface";

// The agent's Compact capsule. It only renders observed state; it never
// invents progress or completion.
export function AgentCapsule({
  snapshot,
  installed,
  readiness,
  buttonRef,
  onOpen,
}: {
  snapshot: AgentSnapshot;
  installed: boolean | null;
  readiness: ProviderReadiness;
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
    >
      <span className="otto-agent-avatar grid place-items-center shrink-0 rounded-full">
        <Icon name="terminal" size={16} />
      </span>
      <span className="otto-compact-copy min-w-0 flex-1">
        <strong>{compactLabel(snapshot, installed)}</strong>
        <small>{compactDetail(snapshot, installed, readiness)}</small>
      </span>
      <VisuallyHidden>Open Agent</VisuallyHidden>
      {snapshot.status === "approvalRequired" ? (
        <span className="otto-compact-marker warn" role="status">
          <Icon name="alert" size={14} strokeWidth={1.9} />
          <VisuallyHidden>Approval needed</VisuallyHidden>
        </span>
      ) : installed === false || snapshot.status === "failed" ? (
        <span className="otto-compact-marker error" role="status">
          <Icon name="unavailable" size={14} strokeWidth={1.9} />
          <VisuallyHidden>{readiness.message}</VisuallyHidden>
        </span>
      ) : thinking ? (
        <Bars />
      ) : snapshot.status === "completed" ? (
        <span className="otto-compact-mark">✓</span>
      ) : null}
    </button>
  );
}
