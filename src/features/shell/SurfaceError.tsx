import { Icon, Text, VisuallyHidden } from "../../shared/ui";

export function SurfaceError({
  message,
  expanded,
  onRetry,
}: {
  message: string | null;
  expanded: boolean;
  onRetry?: () => void;
}) {
  if (!message) return null;
  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-otto-surface text-otto-text"
      role="alert"
      title={message}
    >
      <VisuallyHidden>{message}</VisuallyHidden>
      <button
        type="button"
        className="inline-flex min-h-6 cursor-pointer items-center gap-1 rounded-otto-control px-2"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onRetry?.();
        }}
      >
        <Icon name="alert" size={12} />
        <Text as="span" variant="meta">
          {expanded ? "Retry window" : "Retry"}
        </Text>
      </button>
    </div>
  );
}
