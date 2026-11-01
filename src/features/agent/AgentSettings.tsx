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
  beginWorkspaceEdit: () => void;
  commitWorkspace: (cwd: string) => void;
  cancelWorkspaceEdit: () => void;
  busy: boolean;
  error: string | null;
  onDone: () => void;
  capture: CaptureShortcutModel;
  focusCaptureShortcut: boolean;
  onMeasured: (height: number) => void;
  reducedMotion: boolean;
};

export function AgentSettings(props: AgentSettingsProps) {
  const [tab, setTab] = useState<AgentSettingsTab>("setup");
  const root = useRef<HTMLElement>(null);
  const scrollViewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (props.focusCaptureShortcut) setTab("capture");
  }, [props.focusCaptureShortcut]);
  useLayoutEffect(() => {
    const element = root.current;
    const viewport = scrollViewport.current;
    if (!element || !viewport) return;
    const measure = () => {
      const navigationHeight = element.querySelector("nav")?.offsetHeight ?? 0;
      const contentHeight = viewport.firstElementChild?.scrollHeight ?? viewport.scrollHeight;
      props.onMeasured(navigationHeight + contentHeight + 51);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    return () => observer.disconnect();
  }, [props.onMeasured]);

  return (
    <section ref={root} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <AgentSettingsNavigation tab={tab} onSelect={setTab} />
      <AgentSettingsDetails {...props} tab={tab} scrollRef={scrollViewport} />
    </section>
  );
}
