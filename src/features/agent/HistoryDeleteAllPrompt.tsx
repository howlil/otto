import { Button, Text } from "../../shared/ui";

export function HistoryDeleteAllPrompt({
  disabled,
  onConfirm,
  onCancel,
}: {
  disabled: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="mb-2 rounded-[11px] border border-otto-danger bg-otto-field-deep p-2.5"
      role="alert"
    >
      <Text as="p" variant="meta" className="m-0 mb-2 text-otto-danger-detail">
        Delete all saved conversations? This cannot be undone.
      </Text>
      <div className="flex gap-1.5">
        <Button
          variant="secondary"
          size="xs"
          className="text-otto-danger-detail"
          disabled={disabled}
          onClick={onConfirm}
        >
          Delete all
        </Button>
        <Button variant="quiet" size="xs" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
