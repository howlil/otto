import { Range, SegmentedControl, SettingsSection, Text, Toggle } from "../../shared/ui";
import type { Preferences } from "./preferences";

export function InteractionSettings({
  prefs,
  change,
}: {
  prefs: Preferences;
  change: (patch: Partial<Preferences>) => void;
}) {
  return (
    <SettingsSection title="Interaction & motion">
      <Toggle
        title="Expand on hover"
        checked={prefs.hoverExpand}
        onChange={(hoverExpand) => change({ hoverExpand })}
      />
      <Toggle
        title="Keep expanded when switching apps"
        help="Pinned panels stay open until you close them."
        checked={!prefs.clickOutside}
        onChange={(keepExpanded) => change({ clickOutside: !keepExpanded })}
      />
      <div className="mb-[14px]">
        <Text as="span" variant="meta" className="mb-2 block text-otto-text-secondary">
          Motion profile
        </Text>
        <SegmentedControl
          value={prefs.motion}
          onChange={(motion) => change({ motion })}
          choices={[
            { value: "fluid", label: "Fluid" },
            { value: "gentle", label: "Subtle" },
            { value: "reduced", label: "Reduced" },
          ]}
        />
      </div>
      <details className="mt-3 border-t border-otto-line-soft pt-2">
        <summary className="cursor-pointer list-none text-otto-sm text-otto-text-secondary">
          Hover timing
        </summary>
        <div className="pt-1">
          <Range
            label="Hover intent"
            value={prefs.hoverDelay}
            min={0}
            max={400}
            unit=" ms"
            disabled={!prefs.hoverExpand}
            onChange={(hoverDelay) => change({ hoverDelay })}
          />
          <Range
            label="Leave delay"
            value={prefs.leaveDelay}
            min={0}
            max={650}
            unit=" ms"
            disabled={!prefs.hoverExpand}
            onChange={(leaveDelay) => change({ leaveDelay })}
          />
        </div>
      </details>
    </SettingsSection>
  );
}
