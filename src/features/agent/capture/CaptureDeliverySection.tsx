import { ActiveIndicatorGroup, Icon, Text, type IconName } from "../../../shared/ui";

const DELIVERY_CHOICES: ReadonlyArray<{
  key: string;
  autoSend: boolean;
  label: string;
  icon: IconName;
  hint: string;
}> = [
  {
    key: "stage",
    autoSend: false,
    label: "Stage in composer",
    icon: "messageSquare",
    hint: "Attach to composer so you can add a question first",
  },
  {
    key: "instant",
    autoSend: true,
    label: "Instant auto-send",
    icon: "zap",
    hint: "Send straight to Otto after capture",
  },
];

export function CaptureDeliveryPicker({
  autoSend,
  disabled,
  onChange,
}: {
  autoSend: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <ActiveIndicatorGroup
      activeKey={autoSend ? "instant" : "stage"}
      className="grid grid-cols-2 gap-2"
      indicatorClassName="rounded-otto-card border border-otto-line-focused bg-otto-selected"
    >
      {DELIVERY_CHOICES.map((option) => {
        const selected = autoSend === option.autoSend;
        return (
          <button
            key={option.key}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            title={option.hint}
            data-active-key={option.key}
            onClick={() => onChange(option.autoSend)}
            className={[
              "relative z-[1] flex h-11 min-w-0 items-center gap-2.5 rounded-otto-card border px-2.5 text-left transition-[background,border-color] duration-[var(--otto-selection-duration)] ease-otto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-otto-input-selected disabled:opacity-45",
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
              <Icon name={option.icon} size={15} />
            </span>
            <Text as="span" variant="label" className="min-w-0 flex-1 truncate">
              {option.label}
            </Text>
            {selected && (
              <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-otto-invert-bg text-otto-invert-text">
                <Icon name="check" size={10} />
              </span>
            )}
          </button>
        );
      })}
    </ActiveIndicatorGroup>
  );
}
