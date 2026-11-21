import { Icon, IconButton, Text } from "../../shared/ui";
import type { VoiceViewModel } from "./view-model";

export function ComposerMicControl({
  voice,
  disabled,
  onOpenVoiceSettings,
}: {
  voice: VoiceViewModel;
  disabled: boolean;
  onOpenVoiceSettings?: () => void;
}) {
  if (voice.downloading) {
    const pct = voice.downloadProgress?.percent;
    return (
      <button
        type="button"
        onClick={() => void voice.cancelDownload()}
        title="Cancel Whisper model download"
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-otto-line-mid bg-otto-raised-soft px-2.5 text-otto-xs text-otto-text-bright transition-colors duration-150 hover:border-otto-line-hover"
      >
        <Icon name="download" size={13} />
        <Text as="span" variant="caption">
          {pct !== null && pct !== undefined ? `${pct}%` : "Downloading…"}
        </Text>
      </button>
    );
  }

  if (voice.listening) {
    return (
      <button
        type="button"
        onClick={() => void voice.stopRecording()}
        onContextMenu={(event) => {
          event.preventDefault();
          void voice.cancelVoice();
        }}
        title="Click to transcribe · Right-click or Esc to cancel"
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-otto-ok bg-otto-raised-deep px-2.5 text-otto-xs text-otto-text-bright transition-colors duration-150"
      >
        <span className="h-2 w-2 rounded-full bg-otto-ok motion-safe:animate-pulse" />
        <Text as="span" variant="caption">
          Listening…
        </Text>
      </button>
    );
  }

  if (voice.transcribing) {
    return (
      <button
        type="button"
        onClick={() => void voice.cancelVoice()}
        title="Transcribing voice · Click to cancel"
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-otto-line-mid bg-otto-raised-soft px-2.5 text-otto-xs text-otto-text-secondary"
      >
        <Icon name="mic" size={13} />
        <Text as="span" variant="caption">
          Transcribing…
        </Text>
      </button>
    );
  }

  if (!voice.activeModelReady) {
    return (
      <IconButton
        icon="mic"
        size={15}
        label="Set up voice input"
        variant="quiet"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
        title="Download local Whisper voice model (1 click)"
        disabled={disabled}
        onClick={() => {
          if (onOpenVoiceSettings) onOpenVoiceSettings();
          else void voice.downloadModel();
        }}
      />
    );
  }

  return (
    <IconButton
      icon="mic"
      size={15}
      label="Voice input"
      variant="quiet"
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
      title={`Speak with local Whisper (${voice.shortcut || "Ctrl+Alt+V"})`}
      disabled={disabled}
      onClick={() => void voice.toggleRecording()}
    />
  );
}
