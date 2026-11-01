import { useEffect, useState } from "react";
import type { CaptureShortcutModel } from "./view-model";
import type {
  AgentMode,
  AgentProvider,
  AgentStatus,
  ProviderReadiness,
} from "../../platform/tauri";
import { AgentSettingsNavigation, type AgentSettingsTab } from "./AgentSettingsNavigation";
import { AgentSettingsDetails } from "./AgentSettingsDetails";

export type AgentSettingsProps = {
  readiness: ProviderReadiness;
  provider: AgentProvider;
  setProvider: (provider: AgentProvider) => void;
  runStatus: AgentStatus;
  approvalPending: boolean;
  onRetry: () => void;
  mode: AgentMode;
  setMode: (mode: AgentMode) => void;
  locked: boolean;
  cwd: string;
  setCwd: (cwd: string) => void;
  hasThread: boolean;
  busy: boolean;
  error: string | null;
  onNewSession: () => void;
  onDone: () => void;
  capture: CaptureShortcutModel;
  focusCaptureShortcut: boolean;
};

export function AgentSettings(props: AgentSettingsProps) {
  const [tab, setTab] = useState<AgentSettingsTab>("provider");
  useEffect(() => {
    if (props.focusCaptureShortcut) setTab("capture");
  }, [props.focusCaptureShortcut]);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-[118px_minmax(0,1fr)]">
        <AgentSettingsNavigation tab={tab} onSelect={setTab} />
        <AgentSettingsDetails {...props} tab={tab} />
      </div>
    </section>
  );
}
