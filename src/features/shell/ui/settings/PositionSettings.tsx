import {
  ActiveIndicatorGroup,
  Button,
  ChoiceGroup,
  Range,
  SettingBlock,
  SettingRow,
  StatusMessage,
  Text,
  Toggle,
} from "../../../../shared/ui";
import type { CompactStyle, Preferences } from "../../model/preferences";
import type { PlacementStatus } from "../../hooks/useNotchShell";
import { PlacementChoice } from "./PlacementChoice";

const compactStyleChoices = [
  { value: "capsule" as const, label: "Capsule", icon: "capsuleCompact" as const },
  { value: "circle" as const, label: "Circle", icon: "circleCompact" as const },
];

function attachedDisabledTitle(
  placement: PlacementStatus,
  compactStyle: CompactStyle,
): string | undefined {
  if (placement.ottoOsDetected) return "Otto OS owns the top edge, so Otto stays floating.";
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
  const floating = placement.requested === "floating" || circleSelected || placement.ottoOsDetected;
  const attachedBlocked = !placement.supported || circleSelected || placement.ottoOsDetected;
  return (
    <div className="space-y-4">
      {placement.ottoOsDetected && (
        <Toggle
          icon={placement.dockWithOttoOs ? "link" : "unlink"}
          title="Dock with Otto OS"
          help={placement.dockWithOttoOs ? "Beside the Otto OS notch" : "Detached · free floating"}
          checked={placement.dockWithOttoOs}
          onChange={placement.setDockWithOttoOs}
        />
      )}
      <SettingRow
        icon={circleSelected ? "circleCompact" : "capsuleCompact"}
        title="Compact style"
        help={placement.ottoOs ? "Managed by Otto OS" : undefined}
      >
        <ChoiceGroup<CompactStyle>
          value={circleSelected ? "circle" : "capsule"}
          choices={compactStyleChoices}
          disabled={placement.ottoOs}
          disabledReason="Detach from Otto OS to switch to Capsule"
          onChange={(compactStyle) => change({ compactStyle })}
        />
      </SettingRow>
      <SettingBlock title="Placement" icon="position">
        <ActiveIndicatorGroup
          activeKey={floating ? "floating" : placement.requested}
          className="grid grid-cols-2 gap-2"
          indicatorClassName="rounded-otto-card border border-otto-line-focused bg-otto-selected"
        >
          <PlacementChoice
            value="floating"
            selected={floating}
            label="Floating"
            icon="appWindow"
            title="Floating window you can drag anywhere"
            onSelect={() => placement.change("floating")}
          />
          <PlacementChoice
            value="attached"
            selected={!floating && placement.requested === "attached"}
            label="Attached"
            icon="position"
            disabled={attachedBlocked}
            title={attachedDisabledTitle(placement, prefs.compactStyle) ?? "Joined to the top edge"}
            onSelect={() => placement.change("attached")}
          />
        </ActiveIndicatorGroup>
      </SettingBlock>
      {floating && !placement.ottoOs && prefs.position === null && (
        <Range
          icon="moveVertical"
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
        <SettingRow icon="move" title="Custom position">
          <Button variant="secondary" size="xs" icon="reset" onClick={placement.resetPosition}>
            Reset
          </Button>
        </SettingRow>
      )}
      <PositionNotices placement={placement} compactStyle={prefs.compactStyle} />
    </div>
  );
}
