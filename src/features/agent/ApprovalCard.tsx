import { useEffect, useRef } from "react";
import { Icon } from "../../shared/ui";
import type { AgentApproval } from "../../platform/tauri";

// A waiting interaction, never an implicit confirmation. It only reports the
// decision; Rust owns whether that decision is still current.
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
    const panel = element?.closest<HTMLElement>(".otto-agent");
    if (!panel) return;
    const previous = document.activeElement;
    // An asynchronous CLI event must never activate Otto or steal keyboard
    // focus from another application (B10/G9).
    if (!document.hasFocus() || (previous !== document.body && !panel.contains(previous))) {
      return;
    }
    const origin = previous instanceof HTMLElement && previous !== document.body ? previous : null;
    denyButton.current?.focus({ preventScroll: true });
    if (document.activeElement !== denyButton.current) return;

    return () => {
      // React may remove the focused button before the replacement controls
      // exist. Restore only within a still-mounted, focused Agent surface.
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
          panel.querySelector<HTMLElement>(".otto-gear");
        (usableOrigin ?? fallback)?.focus({ preventScroll: true });
      });
    };
  }, []);

  // A non-modal alertdialog keeps the Stop control reachable by Tab; Escape
  // follows the shell's existing collapse behavior without granting approval.
  return (
    <div
      ref={dialog}
      className="otto-approval"
      role="alertdialog"
      aria-labelledby="otto-approval-title"
      aria-describedby="otto-approval-description otto-approval-detail otto-approval-scope"
    >
      <div className="otto-approval-head flex items-center gap-[7px]">
        <Icon name="alert" size={15} />
        <span id="otto-approval-title">Approval required</span>
      </div>
      <p id="otto-approval-description">
        {approval.title}. Codex needs your permission before this continues.
      </p>
      <code id="otto-approval-detail">{approval.detail}</code>
      {approval.reason && <p className="otto-approval-reason">Reason: {approval.reason}</p>}
      <p id="otto-approval-scope" className="otto-approval-scope">
        {approval.kind === "network"
          ? "Agent Session · Network access — allow this request once."
          : "Agent Session · Allow this action once only."}
      </p>
      <div className="otto-approval-buttons flex gap-[7px]">
        <button type="button" onClick={() => onDecide("allowOnce")}>
          Allow once
        </button>
        <button
          ref={denyButton}
          type="button"
          className="secondary"
          onClick={() => onDecide("deny")}
        >
          Deny
        </button>
      </div>
    </div>
  );
}
