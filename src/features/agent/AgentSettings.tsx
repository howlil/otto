import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CaptureShortcutModel } from "./view-model";
import type {
  AgentMode,
  AgentProvider,
  AgentSnapshot,
  AgentStatus,
  ProviderReadiness,
} from "../../platform/tauri";
import { AgentSettingsNavigation, type AgentSettingsTab } from "./AgentSettingsNavigation";
import { AgentSettingsDetails } from "./AgentSettingsDetails";

export type AgentSettingsProps = {
  readiness: ProviderReadiness;
  provider: AgentProvider;
  setProvider: (provider: AgentProvider) => void;
  snapshot: AgentSnapshot;
  model: string | null;
  setModel: (model: string | null) => void;
  thinkingEffort: string | null;
  setThinkingEffort: (effort: string | null) => void;
  runStatus: AgentStatus;
  approvalPending: boolean;
  onRetry: () => void;
  mode: AgentMode;
  setMode: (mode: AgentMode) => void;
  locked: boolean;
  cwd: string;
  setCwd: (cwd: string) => void;
  busy: boolean;
  error: string | null;
  onDone: () => void;
  capture: CaptureShortcutModel;
  focusCaptureShortcut: boolean;
  onMeasured: (height: number) => void;
};

export function AgentSettings(props: AgentSettingsProps) {
  const [tab, setTab] = useState<AgentSettingsTab>("setup");
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (props.focusCaptureShortcut) setTab("capture");
  }, [props.focusCaptureShortcut]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => props.onMeasured(element.scrollHeight + 51);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [props.onMeasured]);

  return (
    <section ref={root} className="min-w-0">
      <div className="min-w-0">
        <AgentSettingsNavigation tab={tab} onSelect={setTab} />
        <AgentSettingsDetails {...props} tab={tab} />
      </div>
    </section>
  );
}
