import {
  ActiveIndicatorGroup,
  Button,
  ChoiceGroup,
  Range,
  SettingBlock,
  SettingRow,
  StatusMessage,
  Text,
} from "../../../../shared/ui";
import type { CompactStyle, Preferences } from "../../model/preferences";
import type { PlacementStatus } from "../../hooks/useNotchShell";
import { PlacementChoice } from "./PlacementChoice";

const compactStyleChoices = [
  { value: "capsule" as const, label: "Capsule" },
  { value: "circle" as const, label: "Circle" },
];

function attachedDisabledTitle(
  placement: PlacementStatus,
  compactStyle: CompactStyle,
): string | undefined {
  if (placement.ottoOs) return "Otto OS owns the top edge, so Otto stays floating.";
  if (compactStyle === "circle") {
    return "Circle mode floats automatically. Switch to Capsule to use Attached.";
  }
  if (!placement.supported) return "Attached placement is unavailable in this session.";
  return undefined;
}

function PositionNotices({
  placement,
  compactStyle,
}: {
  placement: PlacementStatus;
  compactStyle: CompactStyle;
}) {
  return (
    <>
      {!placement.ottoOs && compactStyle === "circle" && placement.requested === "attached" && (
        <StatusMessage tone="info" className="text-otto-label-muted">
          Circle mode floats automatically. Switch back to Capsule to restore Attached.
        </StatusMessage>
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
    </>
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
  const circleSelected = placement.ottoOs || prefs.compactStyle === "circle";
  const floating = placement.requested === "floating" || circleSelected;
  const attachedBlocked = !placement.supported || circleSelected;
  return (
    <div className="space-y-3">
      <SettingRow
        title="Compact style"
        help={placement.ottoOs ? "Managed by Otto OS" : "Pill bar or 40 px mascot circle"}
      >
        <ChoiceGroup<CompactStyle>
          value={circleSelected ? "circle" : "capsule"}
          choices={compactStyleChoices}
          disabled={placement.ottoOs}
          disabledReason="Otto OS keeps Otto in Circle mode"
          onChange={(compactStyle) => change({ compactStyle })}
        />
      </SettingRow>
      <SettingBlock title="Placement">
        <ActiveIndicatorGroup
          activeKey={circleSelected ? "floating" : placement.requested}
          className="grid grid-cols-2 gap-2"
          indicatorClassName="rounded-otto-card border border-otto-slider-outline bg-otto-raised-deep"
        >
          <PlacementChoice
            value="floating"
            selected={floating}
            label="Floating"
            hint="Below the top edge, movable"
            onSelect={() => placement.change("floating")}
          />
          <PlacementChoice
            value="attached"
            selected={!circleSelected && placement.requested === "attached"}
            label="Attached"
            hint="Joined to the top edge"
            attached
            disabled={attachedBlocked}
            title={attachedDisabledTitle(placement, prefs.compactStyle)}
            onSelect={() => placement.change("attached")}
          />
        </ActiveIndicatorGroup>
      </SettingBlock>
      {floating && prefs.position === null && (
        <Range
          label="Distance from top"
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
        <SettingRow title="Custom position" help="You moved Otto by dragging it">
          <Button variant="quiet" size="xs" onClick={placement.resetPosition}>
            Reset
          </Button>
        </SettingRow>
      )}
      <PositionNotices placement={placement} compactStyle={prefs.compactStyle} />
    </div>
  );
}
