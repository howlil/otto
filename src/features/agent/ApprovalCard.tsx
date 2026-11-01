import { useEffect, useRef } from "react";
import { Button, Icon, Text } from "../../shared/ui";
import type { AgentApproval } from "../../platform/tauri";

export function ApprovalCard({
  approval,
  onDecide,
}: {
  approval: AgentApproval;
  onDecide: (decision: "allowOnce" | "deny") => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const denyButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = dialog.current;
    const panel = element?.closest<HTMLElement>('[data-surface="agent"]');
    if (!panel) return;
    const previous = document.activeElement;

    if (!document.hasFocus() || (previous !== document.body && !panel.contains(previous))) {
      return;
    }
    const origin = previous instanceof HTMLElement && previous !== document.body ? previous : null;
    denyButton.current?.focus({ preventScroll: true });
    if (document.activeElement !== denyButton.current) return;

    return () => {
      requestAnimationFrame(() => {
        if (
          !panel.isConnected ||
          !document.hasFocus() ||
          document.activeElement !== document.body
        ) {
          return;
        }
        const usableOrigin = origin?.isConnected && !origin.matches(":disabled") ? origin : null;
        const fallback =
          panel.querySelector<HTMLElement>("#otto-prompt:not(:disabled)") ??
          panel.querySelector<HTMLElement>('button[title="Stop"]:not(:disabled)') ??
          panel.querySelector<HTMLElement>('button[title="Agent settings"]');
        (usableOrigin ?? fallback)?.focus({ preventScroll: true });
      });
    };
  }, []);

  return (
    <div
      ref={dialog}
      className="rounded-[11px] border border-otto-approval-warn-outline bg-otto-approval-warn-surface p-3 text-otto-approval-warn-foreground"
      role="alertdialog"
      aria-labelledby="otto-approval-title"
      aria-describedby="otto-approval-description otto-approval-detail otto-approval-scope"
    >
      <div className="flex items-center gap-[7px]">
        <Icon name="alert" size={15} />
        <Text as="span" variant="title" id="otto-approval-title">
          Approval required
        </Text>
      </div>
      <Text
        as="p"
        variant="meta"
        id="otto-approval-description"
        className="my-2 leading-[1.5] text-otto-approval-reason-foreground"
      >
        {approval.title}. Codex needs your permission before this continues.
      </Text>
      <Text
        as="code"
        variant="code"
        id="otto-approval-detail"
        className="block max-h-24 overflow-y-auto whitespace-pre-wrap rounded-[7px] bg-otto-approval-reason-surface p-[9px] text-otto-control-text [overflow-wrap:anywhere]"
      >
        {approval.detail}
      </Text>
      {approval.reason && (
        <Text as="p" variant="meta" className="mt-1.5 mb-0 text-otto-approval-caption">
          Reason: {approval.reason}
        </Text>
      )}
      <Text
        as="p"
        variant="meta"
        id="otto-approval-scope"
        className="mt-2 mb-0 text-otto-approval-detail"
      >
        {approval.kind === "network"
          ? "Agent Session · Network access — allow this request once."
          : "Agent Session · Allow this action once only."}
      </Text>
      <div className="mt-[10px] flex gap-[7px]">
        <Button variant="primary" size="xs" onClick={() => onDecide("allowOnce")}>
          Allow once
        </Button>
        <Button ref={denyButton} variant="secondary" size="xs" onClick={() => onDecide("deny")}>
          Deny
        </Button>
      </div>
    </div>
  );
}
