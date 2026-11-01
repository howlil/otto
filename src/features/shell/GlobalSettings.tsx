import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, IconButton, Range, SegmentedControl, Text, Toggle } from "../../shared/ui";
import { defaults, type Preferences, type SettingsTab } from "./preferences";
import { PlacementSettings } from "./PlacementSettings";
import { UpdateSettings } from "./UpdateSettings";
import type { AppUpdateState } from "./useAppUpdate";

export function GlobalSettings({
  prefs,
  change,
  onBack,
  onMeasured,
  update,
  motionClass = "",
}: {
  prefs: Preferences;
  change: (patch: Partial<Preferences>) => void;
  onBack: () => void;
  onMeasured: (height: number) => void;
  update: {
    state: AppUpdateState;
    checkForUpdate: () => Promise<void>;
    installUpdate: () => Promise<void>;
  };
  motionClass?: string;
}) {
  const [tab, setTab] = useState<SettingsTab>("general");
  const back = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    back.current?.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => onMeasured(element.scrollHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [onMeasured]);
  return (
    <section ref={root} className={`flex min-w-0 flex-col ${motionClass}`}>
      <header className="flex h-[51px] shrink-0 items-center gap-[10px] border-b border-otto-line-soft px-[15px]">
        <IconButton icon="back" label="Back to Home" ref={back} onClick={onBack} />
        <Text as="strong" variant="display">
          Settings
        </Text>
      </header>
      <main className="grid min-w-0 grid-cols-[118px_minmax(0,1fr)]">
        <nav
          aria-labelledby="otto-settings-sections"
          className="flex flex-col items-stretch gap-1 border-r border-otto-control-deep bg-otto-nav-bg px-2 py-[13px]"
        >
          <span id="otto-settings-sections" className="sr-only">
            Settings sections
          </span>
          {(["general", "interaction", "placement"] as SettingsTab[]).map((name) => (
            <button
              type="button"
              key={name}
              className={`h-[35px] rounded-otto-control border-0 bg-transparent px-[11px] text-left text-otto-sm text-otto-label-muted hover:bg-otto-control-deep hover:text-otto-hover-text ${tab === name ? "bg-otto-control-deep text-otto-invert-line" : ""}`}
              aria-current={tab === name ? "page" : undefined}
              onClick={() => setTab(name)}
            >
              {name[0].toUpperCase() + name.slice(1)}
            </button>
          ))}
        </nav>
        <div className="min-w-0 overflow-y-auto px-[18px] pb-5 pt-4 text-otto-text [scrollbar-color:var(--color-otto-scrollbar-track)_transparent] [scrollbar-width:thin] [&>h2]:m-0 [&>h2]:mb-[3px] [&>p]:m-0 [&>p]:mb-4">
          {tab === "general" && (
            <>
              <Text as="h2" variant="heading" className="m-0 mb-[3px]">
                General
              </Text>
              <div className="mb-[14px]">
                <Text as="span" variant="meta" className="mb-2 block text-otto-text-secondary">
                  Idle expression
                </Text>
                <SegmentedControl
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
              <div className="mb-[14px]">
                <Text as="span" variant="meta" className="mb-2 block text-otto-text-secondary">
                  Idle response
                </Text>
                <SegmentedControl
                  value={prefs.reactive}
                  onChange={(reactive) => change({ reactive })}
                  choices={[
                    { value: "quiet", label: "Quiet" },
                    { value: "alive", label: "Alive" },
                  ]}
                />
              </div>
              <Button
                variant="quiet"
                size="link"
                className="justify-start"
                onClick={() => change(defaults)}
              >
                Restore defaults
              </Button>
              <UpdateSettings update={update} />
            </>
          )}
          {tab === "interaction" && (
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
                title="Close when returning to desktop"
                checked={prefs.clickOutside}
                onChange={(clickOutside) => change({ clickOutside })}
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
          )}
          {tab === "placement" && <PlacementSettings prefs={prefs} change={change} />}
        </div>
      </main>
    </section>
  );
}
