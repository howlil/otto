import { AgentCapsule } from "../features/agent";
import type { AgentViewModel } from "../features/agent";
import type { ShellViewModel } from "../features/shell";
import type { VoiceViewModel } from "../features/voice";

export function ShellCompactSurface({
  agent,
  shell,
  voice,
}: {
  agent: AgentViewModel;
  shell: ShellViewModel;
  voice?: VoiceViewModel;
}) {
  return (
    <AgentCapsule
      snapshot={agent.snapshot}
      installed={agent.installed}
      readiness={agent.readiness}
      error={agent.error}
      voice={
        voice
          ? {
              listening: voice.listening,
              transcribing: voice.transcribing,
              speaking: voice.speaking,
              error: voice.snapshot.error,
              level: voice.level,
              onStopListening: () => void voice.stopRecording(),
              onCancelListening: () => void voice.cancelVoice(),
              onStopSpeaking: voice.stopSpeaking,
            }
          : undefined
      }
      circle={shell.compactCircle}
      buttonRef={shell.compactButton}
      onOpen={() => shell.open("agent")}
      onToggleCompactStyle={shell.ottoOs ? undefined : shell.toggleCompactStyle}
    />
  );
}
