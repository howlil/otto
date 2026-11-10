import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ActiveIndicatorGroup,
  IconButton,
  SettingsSection,
  Text,
  TransitionContent,
  useTransitionActive,
} from "../../shared/ui";
import { defaults, type Preferences, type SettingsTab } from "./preferences";
import { PlacementSettings } from "./PlacementSettings";
import type { PlacementStatus } from "./useNotchShell";
import { GeneralSettings } from "./GeneralSettings";
import { InteractionSettings } from "./InteractionSettings";
import { SystemSettings } from "./SystemSettings";
import { UpdateSettings } from "./UpdateSettings";
import type { AppUpdateState } from "./useAppUpdate";

const settingsTabs: ReadonlyArray<{ id: SettingsTab; label: string }> = [
  { id: "appearance", label: "Appearance" },
  { id: "interaction", label: "Interaction" },
  { id: "system", label: "System" },
  { id: "placement", label: "Placement" },
];

export function GlobalSettings({
  prefs,
  change,
  onBack,
  onMeasured,
  update,
  reducedMotion,
  captureProtected,
  captureProtectionSupported,
  captureProtectionPending,
  captureProtectionError,
  setCaptureProtection,
  osEventsError,
  placement,
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
  reducedMotion: boolean;
  captureProtected: boolean | null;
  captureProtectionSupported: boolean;
  captureProtectionPending: boolean;
  captureProtectionError: string | null;
  setCaptureProtection: (enabled: boolean) => Promise<void>;
  osEventsError: string | null;
  placement: PlacementStatus;
}) {
  const active = useTransitionActive();
  const [tab, setTab] = useState<SettingsTab>("appearance");
  const restoreDefaults = () => {
    change(defaults);
    if (captureProtectionSupported) void setCaptureProtection(defaults.hideFromCapture);
  };
  const back = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    back.current?.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => {
    const element = root.current;
    if (!active || !element) return;
    const measure = () => onMeasured(element.scrollHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [active, onMeasured]);
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
          <ActiveIndicatorGroup
            activeKey={tab}
            className="flex flex-col items-stretch gap-1"
            indicatorClassName="rounded-otto-control bg-otto-control-deep"
          >
            {settingsTabs.map(({ id, label }) => (
              <button
                type="button"
                key={id}
                data-active-key={id}
                className={`relative z-[1] h-[35px] rounded-otto-control border-0 bg-transparent px-[11px] text-left text-otto-sm text-otto-label-muted transition-colors duration-[var(--otto-selection-duration)] ease-otto hover:bg-otto-control-hover hover:text-otto-hover-text ${tab === id ? "text-otto-invert-line" : ""}`}
                aria-current={tab === id ? "page" : undefined}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </ActiveIndicatorGroup>
        </nav>
        <div className="otto-scrollbar-hidden min-w-0 overflow-y-auto px-[18px] pb-5 pt-4 text-otto-text [&>h2]:m-0 [&>h2]:mb-[3px] [&>p]:m-0 [&>p]:mb-4">
          <TransitionContent transitionKey={tab} kind="tab" reducedMotion={reducedMotion}>
            {tab === "appearance" && (
              <GeneralSettings
                prefs={prefs}
                change={change}
                onRestoreDefaults={restoreDefaults}
                captureProtectionPending={captureProtectionPending}
              />
            )}
            {tab === "interaction" && <InteractionSettings prefs={prefs} change={change} />}
            {tab === "system" && (
              <SettingsSection title="System">
                <SystemSettings
                  prefs={prefs}
                  change={change}
                  captureProtected={captureProtected}
                  captureProtectionSupported={captureProtectionSupported}
                  captureProtectionPending={captureProtectionPending}
                  captureProtectionError={captureProtectionError}
                  onCaptureProtectionChange={setCaptureProtection}
                  osEventsError={osEventsError}
                />
                <UpdateSettings update={update} />
              </SettingsSection>
            )}
            {tab === "placement" && (
              <PlacementSettings prefs={prefs} change={change} placement={placement} />
            )}
          </TransitionContent>
        </div>
      </main>
    </section>
  );
}
