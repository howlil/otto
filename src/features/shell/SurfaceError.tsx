import { Icon, Text, VisuallyHidden } from "../../shared/ui";

export function SurfaceError({ message, expanded }: { message: string | null; expanded: boolean }) {
  if (!message) return null;
  return (
    <div
      className={
        expanded
          ? "pointer-events-none absolute inset-x-2 bottom-1 z-50 truncate rounded-md bg-otto-surface px-2 py-1 text-center text-otto-text"
          : "pointer-events-none absolute bottom-1 right-1 z-50 text-otto-text"
      }
      role="alert"
      title={message}
    >
      {expanded ? (
        <Text as="span" variant="meta">
          {message}
        </Text>
      ) : (
        <Icon name="alert" size={12} />
      )}
      {!expanded && <VisuallyHidden>{message}</VisuallyHidden>}
    </div>
  );
}
