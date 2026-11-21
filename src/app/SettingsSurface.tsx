import { useEffect, useLayoutEffect, useRef } from "react";
import type { AgentViewModel } from "../features/agent";
import { AssistantSettings, CaptureSettings } from "../features/agent";
import type { AppUpdateViewModel, ShellViewModel } from "../features/shell";
import { BehaviorSettings, GeneralSettings, PositionSettings } from "../features/shell";
import { VoiceSettings, type VoiceViewModel } from "../features/voice";
import { IconButton, Text, TransitionContent, useTransitionActive } from "../shared/ui";
import { SettingsNav, settingsTabs } from "./SettingsNav";

const HEADER_HEIGHT = 51;

export function SettingsSurface({
  agent,
  shell,
  voice,
  appUpdate,
  onMeasured,
}: {
  agent: AgentViewModel;
  shell: ShellViewModel;
  voice?: VoiceViewModel;
  appUpdate: AppUpdateViewModel;
  onMeasured: (height: number) => void;
}) {
  const active = useTransitionActive();
  const back = useRef<HTMLButtonElement>(null);
  const nav = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const { settingsTab: tab, setSettingsTab } = shell;
  const heading = settingsTabs.find((item) => item.id === tab)?.label;

  useEffect(() => {
    back.current?.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => {
    const rail = nav.current;
    const content = pane.current?.firstElementChild;
    if (!active || !rail || !content) return;
    const measure = () =>
      onMeasured(
        HEADER_HEIGHT + Math.max(rail.offsetHeight, (content as HTMLElement).offsetHeight),
      );
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    observer.observe(content);
    return () => observer.disconnect();
  }, [active, onMeasured]);

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex h-[51px] shrink-0 items-center gap-[10px] border-b border-otto-line-soft px-[15px]">
        <IconButton icon="back" label="Back to Agent" ref={back} onClick={shell.back} />
        <Text as="strong" variant="display">
          Settings
        </Text>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[132px_minmax(0,1fr)]">
        <div className="border-r border-otto-line-soft bg-otto-nav-glass">
          <div ref={nav}>
            <SettingsNav tab={tab} onSelect={setSettingsTab} />
          </div>
        </div>
        <div
          ref={pane}
          className="otto-scrollbar-hidden min-h-0 min-w-0 overflow-y-auto [overscroll-behavior:contain]"
        >
          <div className="px-[18px] pb-5 pt-3 text-otto-text">
            <h2 className="sr-only">{heading}</h2>
            <TransitionContent transitionKey={tab} kind="tab" reducedMotion={shell.reducedMotion}>
              {tab === "assistant" && <AssistantSettings agent={agent} />}
              {tab === "capture" && (
                <CaptureSettings
                  agent={agent}
                  focusShortcut={shell.settingsFocus === "capture-shortcut"}
                />
              )}
              {tab === "voice" && voice && <VoiceSettings voice={voice} />}
              {tab === "behavior" && <BehaviorSettings prefs={shell.prefs} change={shell.change} />}
              {tab === "position" && (
                <PositionSettings
                  prefs={shell.prefs}
                  change={shell.change}
                  placement={shell.placement}
                />
              )}
              {tab === "general" && (
                <GeneralSettings
                  prefs={shell.prefs}
                  change={shell.change}
                  update={appUpdate}
                  captureProtected={shell.captureProtected}
                  captureProtectionSupported={shell.captureProtectionSupported}
                  captureProtectionPending={shell.captureProtectionPending}
                  captureProtectionError={shell.captureProtectionError}
                  setCaptureProtection={shell.setCaptureProtection}
                  quitSupported={shell.quitSupported}
                  onQuit={shell.quitOtto}
                />
              )}
            </TransitionContent>
          </div>
        </div>
      </div>
    </section>
  );
}
