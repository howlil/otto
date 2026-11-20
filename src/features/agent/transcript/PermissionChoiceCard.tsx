import { useState } from "react";
import { Button, Icon, Text } from "../../../shared/ui";
import type { AgentPendingPermission } from "../../../platform/tauri";

export function PermissionChoiceCard({
  permission,
  onRespond,
}: {
  permission: AgentPendingPermission;
  onRespond?: (requestId: string, allow: boolean) => Promise<void>;
}) {
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const submitting = submittingId === permission.requestId;

  const choose = async (allow: boolean) => {
    if (submitting || !onRespond) return;
    setSubmittingId(permission.requestId);
    try {
      await onRespond(permission.requestId, allow);
    } finally {
      setSubmittingId((current) => (current === permission.requestId ? null : current));
    }
  };

  const showSummary =
    permission.summary.trim().length > 0 && permission.summary.trim() !== permission.title.trim();

  return (
    <fieldset className="m-0 min-w-0 rounded-otto-card border border-otto-line-mid bg-otto-control px-3 py-2.5">
      <div className="flex items-start gap-2">
        <Icon name="alert" size={14} className="mt-0.5 shrink-0 text-otto-text-secondary" />
        <div className="min-w-0 flex-1 space-y-1">
          <Text as="p" variant="label" className="m-0 text-otto-text">
            {`${permission.engine} is asking permission`}
          </Text>
          <Text as="p" variant="body" className="m-0 break-words text-otto-text-secondary">
            {permission.title}
          </Text>
          {showSummary && (
            <Text as="p" variant="meta" className="m-0 break-words text-otto-text-tertiary">
              {permission.summary}
            </Text>
          )}
          <Text as="p" variant="caption" className="m-0 text-otto-text-subtle">
            Otto never approves actions automatically.
          </Text>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="secondary"
          size="xs"
          disabled={submitting || !onRespond}
          onClick={() => void choose(false)}
        >
          Decline & continue
        </Button>
        <Button
          variant="primary"
          size="xs"
          disabled={submitting || !onRespond}
          onClick={() => void choose(true)}
        >
          Allow once
        </Button>
      </div>
    </fieldset>
  );
}
