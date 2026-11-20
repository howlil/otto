import type { AgentSnapshot, ProviderReadiness } from "../../../platform/tauri";
import { Icon, OttoLogo, Text, VisuallyHidden } from "../../../shared/ui";
import { Bars } from "../conversation/AgentControls";
import { compactDetail, compactLabel } from "../model/surface";
import { agentIsWorking, captureIsWorking } from "../model/status";
import { AgentCircle } from "./AgentCircle";

export function AgentCapsule({
  snapshot,
  installed,
  readiness,
  error,
  circle = false,
  buttonRef,
  onOpen,
}: {
  snapshot: AgentSnapshot;
  installed: boolean | null;
  readiness: ProviderReadiness;
  error: string | null;
  circle?: boolean;
  buttonRef: React.Ref<HTMLButtonElement>;
  onOpen: () => void;
}) {
  const thinking = agentIsWorking(snapshot.status) || captureIsWorking(snapshot.capture.phase);
  if (circle) {
    return (
      <AgentCircle
        snapshot={snapshot}
        installed={installed}
        readiness={readiness}
        error={error}
        buttonRef={buttonRef}
        onOpen={onOpen}
      />
    );
  }
  return (
    <button
      ref={buttonRef}
      data-otto-drag-surface="true"
      className="group flex h-full w-full items-center justify-start gap-[9px] border-0 bg-transparent px-[11px] text-left text-inherit"
      type="button"
      onClick={onOpen}
    >
      <OttoLogo compact />
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
      {error || installed === false || snapshot.status === "failed" ? (
        <span className="text-otto-danger" role="status">
          <Icon name="unavailable" size={14} strokeWidth={1.9} />
          <VisuallyHidden>{error || readiness.message}</VisuallyHidden>
        </span>
      ) : thinking ? (
        <Bars />
      ) : null}
    </button>
  );
}
