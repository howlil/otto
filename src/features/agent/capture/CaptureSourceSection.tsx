import type { CaptureSource } from "../../../platform/tauri";
import { Button, type Choice, Text } from "../../../shared/ui";
import type { CaptureShortcutModel } from "../model/view-model";

export const IMAGE_REASON =
  "Needs a provider that accepts images: Codex, Antigravity, or a vision-capable Pi model.";

export function needsWindowTarget(source: CaptureSource): boolean {
  return source === "window" || source === "scrollingWindow";
}

export function sourceChoices(imageTransport: boolean): Choice<CaptureSource>[] {
  const image = { disabled: !imageTransport, disabledReason: IMAGE_REASON };
  return [
    {
      value: "selectedText",
      label: "Selected text",
      help: "The text you highlighted in another app. No screenshot.",
    },
    {
      value: "region",
      label: "Select area",
      help: "Drag an area on screen. Local border only; excluded from screen capture when supported.",
      ...image,
    },
    {
      value: "window",
      label: "Last focused window",
      help: "A screenshot of the window you were just using.",
      ...image,
    },
    {
      value: "scrollingWindow",
      label: "Scrolling window",
      help: "A long page, captured by scrolling that window.",
      ...image,
    },
    {
      value: "fullScreen",
      label: "Full screen",
      help: "A screenshot of the whole screen.",
      ...image,
    },
  ];
}

export function LastWindow({
  targetTitle,
  targetWarning,
  targetPending,
  refreshTarget,
}: Pick<
  CaptureShortcutModel,
  "targetTitle" | "targetWarning" | "targetPending" | "refreshTarget"
>) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <Text
        as="span"
        variant="caption"
        className="min-w-0 flex-1 truncate text-otto-text-tertiary"
        title={targetTitle ?? targetWarning ?? undefined}
      >
        {targetPending
          ? "Checking last window…"
          : targetTitle
            ? `Last observed: ${targetTitle}`
            : (targetWarning ?? "Focus another app to select a capture target.")}
      </Text>
      <Button
        variant="quiet"
        size="xs"
        disabled={targetPending}
        onClick={() => void refreshTarget()}
      >
        Refresh
      </Button>
    </div>
  );
}
