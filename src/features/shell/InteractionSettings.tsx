import { Range, SegmentedControl, Text, Toggle } from "../../shared/ui";
import type { Preferences } from "./preferences";

export function InteractionSettings({
  prefs,
  change,
}: {
  prefs: Preferences;
  change: (patch: Partial<Preferences>) => void;
}) {
  return (
    <>
      <Text as="h2" variant="heading" className="m-0 mb-[3px]">
        Interaction & motion
      </Text>
      <Toggle
        title="Expand on hover"
        checked={prefs.hoverExpand}
        onChange={(hoverExpand) => change({ hoverExpand })}
      />
      <Range
        label="Hover intent"
        value={prefs.hoverDelay}
        min={0}
        max={400}
        unit=" ms"
        onChange={(hoverDelay) => change({ hoverDelay })}
      />
      <Range
        label="Leave delay"
        value={prefs.leaveDelay}
        min={0}
        max={650}
        unit=" ms"
        onChange={(leaveDelay) => change({ leaveDelay })}
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
      <Range
        label="Artwork tilt"
        value={prefs.tilt}
        min={0}
        max={65}
        unit="°"
        onChange={(tilt) => change({ tilt })}
      />
      <Range
        label="Tonal gradient"
        value={prefs.gradient}
        min={0}
        max={100}
        unit="%"
        onChange={(gradient) => change({ gradient })}
      />
    </>
  );
}
