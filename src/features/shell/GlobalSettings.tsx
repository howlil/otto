import { useEffect, useRef, useState } from "react";
import { Icon, VisuallyHidden } from "../../shared/ui";
import { ChoiceChip, Range, Toggle } from "./SettingsControls";
import { defaults, type Preferences, type SettingsTab } from "./preferences";

export function GlobalSettings({
  prefs,
  change,
  onBack,
}: {
  prefs: Preferences;
  change: (patch: Partial<Preferences>) => void;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>("general");
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    back.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section className="otto-global-settings flex h-full min-h-0 flex-col">
      <header className="otto-settings-head flex shrink-0 items-center gap-[10px]">
        <button className="otto-icon-button" ref={back} type="button" onClick={onBack}>
          <Icon name="back" />
          <VisuallyHidden>Back to Home</VisuallyHidden>
        </button>
        <strong>Settings</strong>
        <span className="otto-settings-meta">Otto</span>
      </header>
      <div className="otto-settings-layout grid min-h-0 flex-1">
        <nav
          aria-labelledby="otto-settings-sections"
          className="otto-settings-nav flex flex-col items-stretch gap-1"
        >
          <span id="otto-settings-sections" className="sr-only">
            Settings sections
          </span>
          {(["general", "interaction", "motion", "placement"] as SettingsTab[]).map((name) => (
            <button
              type="button"
              key={name}
              className={tab === name ? "selected" : ""}
              aria-current={tab === name ? "page" : undefined}
              onClick={() => setTab(name)}
            >
              {name[0].toUpperCase() + name.slice(1)}
            </button>
          ))}
        </nav>
        <div className="otto-settings-content min-h-0 overflow-y-auto text-otto-text">
          {tab === "general" && (
            <>
              <h2>General</h2>
              <p>Choose how Otto feels while idle.</p>
              <div className="otto-setting-group">
                <span>Idle expression</span>
                <ChoiceChip
                  value={prefs.expression}
                  onChange={(expression) => change({ expression })}
                  choices={[
                    { value: "calm", label: "Calm" },
                    { value: "curious", label: "Curious" },
                    { value: "sleepy", label: "Sleepy" },
                    { value: "happy", label: "Happy" },
                  ]}
                />
              </div>
              <div className="otto-setting-group">
                <span>Idle response</span>
                <ChoiceChip
                  value={prefs.reactive}
                  onChange={(reactive) => change({ reactive })}
                  choices={[
                    { value: "quiet", label: "Quiet" },
                    { value: "alive", label: "Alive" },
                  ]}
                />
              </div>
              <button
                className="otto-settings-reset"
                type="button"
                onClick={() => change(defaults)}
              >
                Restore defaults
              </button>
            </>
          )}
          {tab === "interaction" && (
            <>
              <h2>Interaction</h2>
              <p>Decide when the island responds to your pointer.</p>
              <Toggle
                title="Expand on hover"
                help="Preview without stealing focus"
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
                title="Close when returning to desktop"
                help="Escape always closes the panel"
                checked={prefs.clickOutside}
                onChange={(clickOutside) => change({ clickOutside })}
              />
            </>
          )}
          {tab === "motion" && (
            <>
              <h2>Motion</h2>
              <p>Reduced motion from Windows always takes priority.</p>
              <div className="otto-setting-group">
                <span>Motion profile</span>
                <ChoiceChip
                  value={prefs.motion}
                  onChange={(motion) => change({ motion })}
                  choices={[
                    { value: "fluid", label: "Fluid" },
                    { value: "gentle", label: "Subtle" },
                    { value: "reduced", label: "Reduced" },
                  ]}
                />
              </div>
              <Toggle
                title="Pointer depth"
                help="Subtle depth on Home illustrations"
                checked={prefs.parallax}
                onChange={(parallax) => change({ parallax })}
              />
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
          )}
          {tab === "placement" && (
            <>
              <h2>Placement</h2>
              <p>Position Otto relative to the top of the screen.</p>
              <div className="otto-placement-grid grid grid-cols-2 gap-2">
                <button type="button" aria-pressed="true" className="selected">
                  <span className="otto-place-graphic">
                    <i />
                  </span>
                  Floating
                </button>
                <button
                  type="button"
                  disabled
                  title="Attached placement needs Windows-native hit-region support"
                >
                  <span className="otto-place-graphic attached">
                    <i />
                  </span>
                  Attached
                </button>
              </div>
              <Range
                label="Top offset"
                value={prefs.topOffset}
                min={0}
                max={64}
                unit=" px"
                onChange={(topOffset) => change({ topOffset })}
              />
              <p className="otto-availability">
                Attached requires native hit-region verification and is not available in this slice.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
