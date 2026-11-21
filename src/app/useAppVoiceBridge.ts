import { useEffect, useRef } from "react";
import type { AgentViewModel } from "../features/agent";
import type { ShellViewModel } from "../features/shell";
import { useVoice, type VoiceViewModel } from "../features/voice";

function autoReadLatestAssistantMessage(
  messages: ReadonlyArray<{ id: string; role: string; text: string }>,
  mode: "off" | "voice-only" | "always",
  voiceOrigin: boolean,
  speakMessage: (id: string, text: string) => void,
) {
  const shouldSpeak = mode === "always" || (mode === "voice-only" && voiceOrigin);
  if (!shouldSpeak) return;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const msg = messages[index];
    if (msg.role === "assistant" && msg.text.trim().length > 0) {
      speakMessage(msg.id, msg.text);
      return;
    }
  }
}

export function useAppVoiceBridge(agent: AgentViewModel, shell: ShellViewModel): VoiceViewModel {
  const voiceOriginTurnRef = useRef(false);
  const voice = useVoice({
    onTranscript: (text, autoSend) => {
      voiceOriginTurnRef.current = true;
      if (autoSend && agent.sendText) {
        void agent.sendText(text);
        return;
      }
      const nextDraft = agent.draft.trim() ? `${agent.draft.trim()} ${text}` : text;
      agent.setDraft(nextDraft);
      if (!shell.expanded) {
        shell.open("agent", true);
      }
    },
    onModelRequired: () => {
      shell.openSettings("voice");
    },
  });

  const lastStatus = useRef(agent.snapshot.status);
  useEffect(() => {
    const previous = lastStatus.current;
    const current = agent.snapshot.status;
    lastStatus.current = current;
    if (previous === current) return;
    if (current === "completed") {
      autoReadLatestAssistantMessage(
        agent.snapshot.messages,
        voice.prefs.readAloudMode,
        voiceOriginTurnRef.current,
        voice.speakMessage,
      );
      voiceOriginTurnRef.current = false;
    } else if (current === "failed" || current === "stopped") {
      voiceOriginTurnRef.current = false;
    }
  }, [
    agent.snapshot.messages,
    agent.snapshot.status,
    voice.prefs.readAloudMode,
    voice.speakMessage,
  ]);

  useEffect(() => {
    if (!voice.listening && !voice.transcribing && !voice.speaking) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (voice.listening || voice.transcribing) void voice.cancelVoice();
      else voice.stopSpeaking();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [voice.cancelVoice, voice.listening, voice.speaking, voice.stopSpeaking, voice.transcribing]);

  return voice;
}
