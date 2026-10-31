import { Icon, VisuallyHidden } from "../../shared/ui";

// All Shell surfaces retain recoverable feedback from native geometry errors.
export function SurfaceError({
  message,
  expanded,
}: {
  message: string | null;
  expanded: boolean;
}) {
  if (!message) return null;
  return (
    <div
      className={
        expanded
          ? "pointer-events-none absolute inset-x-2 bottom-1 z-50 truncate rounded-md bg-otto-surface px-2 py-1 text-center text-[10px] text-otto-text"
          : "pointer-events-none absolute bottom-1 right-1 z-50 text-otto-text"
      }
      role="alert"
      title={message}
    >
      {expanded ? message : <Icon name="alert" size={12} />}
      {!expanded && <VisuallyHidden>{message}</VisuallyHidden>}
    </div>
  );
}
