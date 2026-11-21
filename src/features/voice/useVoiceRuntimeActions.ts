import { useCallback, useRef } from "react";
import {
  nativeAvailable,
  voiceCancel,
  voiceCancelDownload,
  voiceDeleteModel,
  voiceDownloadModel,
  voiceStartRecording,
  voiceStopRecording,
  type VoiceModelId,
  type VoicePhase,
  type VoiceSnapshot,
} from "../../platform/tauri";
import type { VoicePreferences } from "./preferences";

export function useVoiceRuntimeActions({
  snapshotPhase,
  prefsRef,
  updatePrefs,
  acceptSnapshot,
  setErrorSnapshot,
  setLevel,
  stopSpeaking,
  onModelRequired,
}: {
  snapshotPhase: VoicePhase;
  prefsRef: { current: VoicePreferences };
  updatePrefs: (patch: Partial<VoicePreferences>) => void;
  acceptSnapshot: (next: VoiceSnapshot) => void;
  setErrorSnapshot: (error: string | null) => void;
  setLevel: (level: number) => void;
  stopSpeaking: () => void;
  onModelRequired?: () => void;
}) {
  const startRecording = useCallback(async () => {
    stopSpeaking();
    if (!nativeAvailable) {
      setErrorSnapshot("Voice input requires Otto for Windows.");
      return;
    }
    try {
      const next = await voiceStartRecording({
        modelId: prefsRef.current.modelId,
        language: prefsRef.current.language,
        deviceId: prefsRef.current.deviceId === "default" ? null : prefsRef.current.deviceId,
        autoStopSilence: prefsRef.current.autoStopSilence,
      });
      acceptSnapshot(next);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setErrorSnapshot(msg);
      if (msg.includes("not downloaded")) onModelRequired?.();
    }
  }, [acceptSnapshot, onModelRequired, prefsRef, setErrorSnapshot, stopSpeaking]);

  const stopRecording = useCallback(async () => {
    if (!nativeAvailable) return;
    try {
      const next = await voiceStopRecording();
      acceptSnapshot(next);
    } catch (error) {
      setErrorSnapshot(error instanceof Error ? error.message : String(error));
    }
  }, [acceptSnapshot, setErrorSnapshot]);

  const cancelVoice = useCallback(async () => {
    setLevel(0);
    if (!nativeAvailable) {
      setErrorSnapshot(null);
      return;
    }
    try {
      const next = await voiceCancel();
      acceptSnapshot(next);
    } catch {}
  }, [acceptSnapshot, setErrorSnapshot, setLevel]);

  const toggleRecording = useCallback(async () => {
    if (snapshotPhase === "listening") {
      await stopRecording();
    } else if (snapshotPhase === "transcribing") {
      await cancelVoice();
    } else if (snapshotPhase !== "downloading") {
      await startRecording();
    }
  }, [cancelVoice, snapshotPhase, startRecording, stopRecording]);

  const toggleRef = useRef(toggleRecording);
  toggleRef.current = toggleRecording;

  const downloadModel = useCallback(
    async (modelId?: VoiceModelId) => {
      const target = modelId ?? prefsRef.current.modelId;
      if (modelId && modelId !== prefsRef.current.modelId) {
        updatePrefs({ modelId });
      }
      if (!nativeAvailable) return;
      try {
        const next = await voiceDownloadModel(target);
        acceptSnapshot(next);
      } catch (error) {
        setErrorSnapshot(error instanceof Error ? error.message : String(error));
      }
    },
    [acceptSnapshot, prefsRef, setErrorSnapshot, updatePrefs],
  );

  const cancelDownload = useCallback(async () => {
    if (!nativeAvailable) return;
    try {
      const next = await voiceCancelDownload();
      acceptSnapshot(next);
    } catch {}
  }, [acceptSnapshot]);

  const deleteModel = useCallback(
    async (modelId: VoiceModelId) => {
      if (!nativeAvailable) return;
      try {
        const next = await voiceDeleteModel(modelId);
        acceptSnapshot(next);
      } catch (error) {
        setErrorSnapshot(error instanceof Error ? error.message : String(error));
      }
    },
    [acceptSnapshot, setErrorSnapshot],
  );

  return {
    startRecording,
    stopRecording,
    cancelVoice,
    toggleRecording,
    toggleRef,
    downloadModel,
    cancelDownload,
    deleteModel,
  };
}
