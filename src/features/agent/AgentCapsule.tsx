import type { AgentSnapshot, ProviderReadiness } from "../../platform/tauri";
import { Icon, Text, VisuallyHidden } from "../../shared/ui";
import { Bars } from "./AgentControls";
import { compactDetail, compactLabel } from "./surface";
import { agentIsWorking } from "./status";

export function AgentCapsule({
  snapshot,
  installed,
  readiness,
  error,
  buttonRef,
  onOpen,
  motionClass = "",
}: {
  snapshot: AgentSnapshot;
  installed: boolean | null;
  readiness: ProviderReadiness;
  error: string | null;
  buttonRef: React.Ref<HTMLButtonElement>;
  onOpen: () => void;
  motionClass?: string;
}) {
  const thinking = agentIsWorking(snapshot.status);
  return (
    <button
      ref={buttonRef}
      className={`flex h-full w-full items-center justify-start gap-[9px] border-0 bg-transparent px-[11px] text-left text-inherit ${motionClass}`}
      type="button"
      onClick={onOpen}
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-otto-compact-icon text-otto-text-bright">
        <Icon name="terminal" size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <Text
          as="strong"
          variant="title"
          className="block overflow-hidden text-ellipsis whitespace-nowrap"
        >
          {compactLabel(snapshot, installed, error, readiness.status)}
        </Text>
        <Text
          as="small"
          variant="meta"
          className="mt-0.5 block overflow-hidden text-ellipsis whitespace-nowrap text-otto-text-secondary"
        >
          {compactDetail(snapshot, installed, readiness, error)}
        </Text>
      </span>
      <VisuallyHidden>Open Agent</VisuallyHidden>
      {snapshot.status === "approvalRequired" ? (
        <span className="text-otto-warn" role="status">
          <Icon name="alert" size={14} strokeWidth={1.9} />
          <VisuallyHidden>Approval needed</VisuallyHidden>
        </span>
      ) : error || installed === false || snapshot.status === "failed" ? (
        <span className="text-otto-danger" role="status">
          <Icon name="unavailable" size={14} strokeWidth={1.9} />
          <VisuallyHidden>{error || readiness.message}</VisuallyHidden>
        </span>
      ) : thinking ? (
        <Bars />
      ) : snapshot.status === "completed" ? (
        <span className="px-[5px] text-otto-2xl text-otto-completion-soft">✓</span>
      ) : null}
    </button>
  );
}
