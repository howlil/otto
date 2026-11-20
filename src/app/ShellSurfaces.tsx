import { AgentPanel } from "../features/agent";
import type { AgentViewModel } from "../features/agent";
import type { AppUpdateViewModel, ShellViewModel } from "../features/shell";
import { SettingsSurface } from "./SettingsSurface";
import { ShellCompactSurface } from "./ShellCompactSurface";

export function SurfaceBody({
  agent,
  shell,
  appUpdate,
  onContentMeasured,
}: {
  agent: AgentViewModel;
  shell: ShellViewModel;
  appUpdate: AppUpdateViewModel;
  onContentMeasured: (height: number) => void;
}) {
  const { expanded, page } = shell;
  if (!expanded) {
    return <ShellCompactSurface agent={agent} shell={shell} />;
  }
  if (page === "settings") {
    return (
      <SettingsSurface
        agent={agent}
        shell={shell}
        appUpdate={appUpdate}
        onMeasured={onContentMeasured}
      />
    );
  }
  return (
    <AgentPanel
      agent={agent}
      settingsButtonRef={shell.settingsButton}
      onSettings={() => shell.openSettings()}
      onConfigureCapture={() => shell.openSettings("capture", "capture-shortcut")}
      eventMotion={shell.eventMotion}
      onMeasured={onContentMeasured}
      reducedMotion={shell.reducedMotion}
    />
  );
}
