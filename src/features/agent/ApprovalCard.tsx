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
  return (
    <div className="otto-approval" role="alertdialog" aria-label="Approval required">
      <div className="otto-approval-head flex items-center gap-[7px]">
        <Icon name="alert" size={15} />
        Approval required
      </div>
      <p>{approval.title}. Codex needs your permission before this continues.</p>
      <code>{approval.detail}</code>
      {approval.reason && <p className="otto-approval-reason">Reason: {approval.reason}</p>}
      <p className="otto-approval-scope">
        Agent Session · Workspace write — allowing runs this action once only.
      </p>
      <div className="otto-approval-buttons flex gap-[7px]">
        <button type="button" onClick={() => onDecide("allowOnce")}>
          Allow once
        </button>
        <button type="button" className="secondary" onClick={() => onDecide("deny")}>
          Deny
        </button>
      </div>
    </div>
  );
}
