import { Button, Text } from "../../../shared/ui";

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
      className="mb-2.5 flex items-center justify-between gap-2.5 rounded-otto-panel border border-otto-danger bg-otto-field-deep px-3 py-2.5"
      role="alert"
    >
      <Text as="p" variant="meta" className="m-0 min-w-0 flex-1 text-otto-danger-detail">
        Delete all saved conversations? This cannot be undone.
      </Text>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          variant="secondary"
          size="xs"
          className="border-otto-danger text-otto-danger-copy hover:bg-otto-error-bg"
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
