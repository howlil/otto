import { ActiveIndicatorGroup, Range, SettingsSection, StatusMessage, Text } from "../../shared/ui";
import type { Placement, Preferences } from "./preferences";
import type { PlacementStatus } from "./useNotchShell";

function PlacementChoice({
  selected,
  disabled,
  title,
  label,
  value,
  attached,
  onSelect,
}: {
  selected: boolean;
  disabled?: boolean;
  title?: string;
  label: string;
  value: Placement;
  attached?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      title={title}
      data-active-key={value}
      className={`relative z-[1] flex flex-col items-center gap-[7px] rounded-otto-card border px-[7px] py-[10px] text-otto-text-paper transition-[background,border-color] duration-[var(--otto-selection-duration)] ease-otto disabled:opacity-[0.43] ${selected ? "border-transparent bg-transparent" : "border-otto-line-strong bg-otto-field-deep"}`}
      onClick={onSelect}
    >
      <span className="relative block h-[42px] w-[77px] rounded-[5px] border border-otto-slider-border bg-otto-ink-deep">
        <i
          className={
            attached
              ? "absolute left-[17px] top-0 h-[13px] w-[41px] rounded-[0_0_12px_12px] bg-otto-slider-thumb"
              : "absolute left-5 top-2 h-[10px] w-[35px] rounded-[20px] bg-otto-slider-thumb"
          }
        />
      </span>
      <Text as="span" variant="meta" className="leading-[1.2]">
        {label}
      </Text>
    </button>
  );
}

export function PlacementSettings({
  prefs,
  change,
  placement,
}: {
  prefs: Preferences;
  change: (patch: Partial<Preferences>) => void;
  placement: PlacementStatus;
}) {
  const select = (next: Placement) => placement.change(next);
  return (
    <SettingsSection title="Placement">
      <div className="mb-[15px]">
        <ActiveIndicatorGroup
          activeKey={placement.requested}
          className="grid grid-cols-2 gap-2"
          indicatorClassName="rounded-otto-card border border-otto-slider-outline bg-otto-raised-deep"
        >
          <PlacementChoice
            value="floating"
            selected={placement.requested === "floating"}
            label="Floating"
            onSelect={() => select("floating")}
          />
          <PlacementChoice
            value="attached"
            selected={placement.requested === "attached"}
            label="Attached"
            attached
            disabled={!placement.supported}
            title={
              !placement.supported
                ? "Attached placement is unavailable in this session."
                : undefined
            }
            onSelect={() => select("attached")}
          />
        </ActiveIndicatorGroup>
      </div>
      {placement.requested === "floating" && (
        <Range
          label="Top offset"
          value={prefs.topOffset}
          min={0}
          max={64}
          unit=" px"
          onChange={(topOffset) => change({ topOffset })}
        />
      )}
      {!placement.supported && (
        <StatusMessage tone="warn" className="mt-3 text-otto-label-muted">
          Attached needs the native Windows hit region and is unavailable in this session.
        </StatusMessage>
      )}
      {placement.error && (
        <StatusMessage
          tone="error"
          className="mt-3 text-otto-label-muted"
          action={{ label: "Retry", onClick: placement.retry }}
        >
          {placement.error}
        </StatusMessage>
      )}
      <Text as="p" variant="meta" className="mt-3 text-otto-label-muted">
        Attached joins the capsule to the top screen edge with curved shoulders. The shoulder curve
        stays outside the window hit region.
      </Text>
    </SettingsSection>
  );
}
