import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconButton, Text, TransitionContent } from "../../shared/ui";
import type { Preferences, SettingsTab } from "./preferences";
import { PlacementSettings } from "./PlacementSettings";
import { GeneralSettings } from "./GeneralSettings";
import { InteractionSettings } from "./InteractionSettings";
import type { AppUpdateState } from "./useAppUpdate";

type GlobalSettingsProps = {
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
};

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
  motionClass = "",
}: GlobalSettingsProps) {
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
        <div className="otto-scrollbar-hidden min-w-0 overflow-y-auto px-[18px] pb-5 pt-4 text-otto-text [&>h2]:m-0 [&>h2]:mb-[3px] [&>p]:m-0 [&>p]:mb-4">
          <TransitionContent transitionKey={tab} kind="tab" reducedMotion={reducedMotion}>
            {tab === "general" && (
              <GeneralSettings
                prefs={prefs}
                change={change}
                update={update}
                captureProtected={captureProtected}
                captureProtectionSupported={captureProtectionSupported}
                captureProtectionPending={captureProtectionPending}
                captureProtectionError={captureProtectionError}
                onCaptureProtectionChange={setCaptureProtection}
                osEventsError={osEventsError}
              />
            )}
            {tab === "interaction" && <InteractionSettings prefs={prefs} change={change} />}
            {tab === "placement" && <PlacementSettings prefs={prefs} change={change} />}
          </TransitionContent>
        </div>
      </main>
    </section>
  );
}
