import { AgentPanel } from "../features/agent";
import type { AgentViewModel } from "../features/agent";
import type { AppUpdateViewModel, ShellViewModel } from "../features/shell";
import { ComposerMicControl, type VoiceViewModel } from "../features/voice";
import { SettingsSurface } from "./SettingsSurface";
import { ShellCompactSurface } from "./ShellCompactSurface";

export function SurfaceBody({
  agent,
  shell,
  voice,
  appUpdate,
  onContentMeasured,
}: {
  agent: AgentViewModel;
  shell: ShellViewModel;
  voice?: VoiceViewModel;
  appUpdate: AppUpdateViewModel;
  onContentMeasured: (height: number) => void;
}) {
  const { expanded, page } = shell;
  if (!expanded) {
    return <ShellCompactSurface agent={agent} shell={shell} voice={voice} />;
  }
  if (page === "settings") {
    return (
      <SettingsSurface
        agent={agent}
        shell={shell}
        voice={voice}
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
      compactCircle={shell.compactCircle}
      compactStyleLocked={shell.ottoOs}
      onToggleCompactStyle={shell.toggleCompactStyle}
      voiceControl={
        voice ? (
          <ComposerMicControl
            voice={voice}
            disabled={agent.busy || agent.captureBusy}
            onOpenVoiceSettings={() => shell.openSettings("voice")}
          />
        ) : undefined
      }
      speakingMessageId={voice?.speakingMessageId}
      onToggleSpeak={voice?.toggleSpeakMessage}
    />
  );
}
