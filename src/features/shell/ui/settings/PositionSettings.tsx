import {
  ActiveIndicatorGroup,
  Button,
  Range,
  SettingBlock,
  SettingRow,
  StatusMessage,
  Text,
} from "../../../../shared/ui";
import type { Placement, Preferences } from "../../model/preferences";
import type { PlacementStatus } from "../../hooks/useNotchShell";

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

export function PositionSettings({
  prefs,
  change,
  placement,
}: {
  prefs: Preferences;
  change: (patch: Partial<Preferences>) => void;
  placement: PlacementStatus;
}) {
  const floating = placement.requested === "floating";
  const attachedBlocked = !placement.supported || placement.ottoOs;
  return (
    <div className="space-y-3">
      <SettingBlock title="Placement">
        <ActiveIndicatorGroup
          activeKey={placement.requested}
          className="grid grid-cols-2 gap-2"
          indicatorClassName="rounded-otto-card border border-otto-slider-outline bg-otto-raised-deep"
        >
          <PlacementChoice
            value="floating"
            selected={floating}
            label="Floating"
            onSelect={() => placement.change("floating")}
          />
          <PlacementChoice
            value="attached"
            selected={placement.requested === "attached"}
            label="Attached"
            attached
            disabled={attachedBlocked}
            title={
              placement.ottoOs
                ? "Otto OS owns the top edge, so Otto stays floating."
                : !placement.supported
                  ? "Attached placement is unavailable in this session."
                  : undefined
            }
            onSelect={() => placement.change("attached")}
          />
        </ActiveIndicatorGroup>
      </SettingBlock>
      {floating && prefs.position === null && (
        <Range
          label="Top offset"
          value={prefs.topOffset}
          min={0}
          max={64}
          unit=" px"
          onChange={(topOffset) => change({ topOffset })}
        />
      )}
      {floating && prefs.position === null && (
        <Text as="p" variant="caption" className="text-otto-text-tertiary">
          Drag Otto anywhere to move it.
        </Text>
      )}
      {floating && prefs.position !== null && (
        <SettingRow title="Custom position">
          <Button variant="quiet" size="xs" onClick={placement.resetPosition}>
            Reset
          </Button>
        </SettingRow>
      )}
      {placement.ottoOs && (
        <StatusMessage tone="info" className="text-otto-label-muted">
          Otto OS is running. Otto shows as a circle beside its notch.
        </StatusMessage>
      )}
      {!placement.supported && (
        <StatusMessage tone="warn" className="text-otto-label-muted">
          Attached needs the native Windows hit region and is unavailable in this session.
        </StatusMessage>
      )}
      {placement.error && (
        <StatusMessage
          tone="error"
          className="text-otto-label-muted"
          action={{ label: "Retry", onClick: placement.retry }}
        >
          {placement.error}
        </StatusMessage>
      )}
    </div>
  );
}
