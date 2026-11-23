import type { CaptureSource } from "../../../platform/tauri";
import {
  ActiveIndicatorGroup,
  Icon,
  IconButton,
  type Choice,
  type IconName,
  Text,
} from "../../../shared/ui";
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
      value: "region",
      label: "Region snip",
      icon: "crop",
      help: "Drag an area on screen",
      ...image,
    },
    {
      value: "window",
      label: "Last focused window",
      icon: "appWindow",
      help: "The app you were just using",
      ...image,
    },
    {
      value: "scrollingWindow",
      label: "Scrolling window",
      icon: "scrollText",
      help: "Stitches a tall scrollable page",
      ...image,
    },
    {
      value: "fullScreen",
      label: "Full screen",
      icon: "monitor",
      help: "Everything on your display",
      ...image,
    },
    {
      value: "selectedText",
      label: "Selected text",
      icon: "textSelect",
      help: "The text you highlighted in another app. No screenshot.",
    },
  ];
}

function CaptureSourceCard({
  choice,
  selected,
  disabled,
  wide,
  onSelect,
}: {
  choice: Choice<CaptureSource>;
  selected: boolean;
  disabled: boolean;
  wide?: boolean;
  onSelect: () => void;
}) {
  const unavailable = disabled || choice.disabled;
  const icon: IconName = choice.icon ?? "camera";
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={unavailable}
      title={choice.disabled ? choice.disabledReason : choice.help}
      data-active-key={choice.value}
      onClick={onSelect}
      className={[
        "relative z-[1] flex h-11 min-w-0 items-center gap-2.5 rounded-otto-card border px-2.5 text-left transition-[background,border-color] duration-[var(--otto-selection-duration)] ease-otto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-otto-input-selected disabled:opacity-45",
        wide ? "col-span-2" : "",
        selected
          ? "border-transparent bg-transparent text-otto-text"
          : "border-otto-line bg-otto-control text-otto-text-secondary hover:border-otto-line-hover hover:bg-otto-control-hover hover:text-otto-text",
      ].join(" ")}
    >
      <span
        className={`flex size-7 shrink-0 items-center justify-center rounded-otto-control ${
          selected
            ? "bg-otto-raised-deep text-otto-text"
            : "bg-otto-ink-deep text-otto-text-tertiary"
        }`}
      >
        <Icon name={icon} size={15} />
      </span>
      <Text as="span" variant="label" className="min-w-0 flex-1 truncate">
        {choice.label}
      </Text>
      {selected && (
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-otto-invert-bg text-otto-invert-text">
          <Icon name="check" size={10} />
        </span>
      )}
    </button>
  );
}

export function CaptureSourceGrid({
  value,
  choices,
  disabled,
  onChange,
}: {
  value: CaptureSource;
  choices: readonly Choice<CaptureSource>[];
  disabled: boolean;
  onChange: (next: CaptureSource) => void;
}) {
  return (
    <ActiveIndicatorGroup
      activeKey={value}
      className="grid grid-cols-2 gap-2"
      indicatorClassName="rounded-otto-card border border-otto-line-focused bg-otto-selected"
    >
      {choices.map((choice) => (
        <CaptureSourceCard
          key={choice.value}
          choice={choice}
          selected={value === choice.value}
          disabled={disabled}
          wide={choice.value === "selectedText"}
          onSelect={() => onChange(choice.value)}
        />
      ))}
    </ActiveIndicatorGroup>
  );
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
    <div className="mt-2 flex h-9 items-center gap-2 rounded-otto-control border border-otto-line-soft bg-otto-field-deep/70 pl-2.5 pr-1">
      <Icon name="appWindow" size={13} className="shrink-0 text-otto-text-tertiary" />
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
      <IconButton
        icon="refresh"
        label="Refresh"
        title="Refresh last window"
        variant="quiet"
        size={13}
        disabled={targetPending}
        onClick={() => void refreshTarget()}
      />
    </div>
  );
}
