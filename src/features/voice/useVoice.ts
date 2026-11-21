import { useCallback, useRef, useState } from "react";
import { nativeAvailable, type VoiceSnapshot } from "../../platform/tauri";
import { readVoicePreferences, writeVoicePreferences, type VoicePreferences } from "./preferences";
import { useSpeechOutput } from "./useSpeechOutput";
import { useVoiceEvents } from "./useVoiceEvents";
import { useVoiceRuntimeActions } from "./useVoiceRuntimeActions";
import type { VoiceViewModel } from "./view-model";

const initialSnapshot: VoiceSnapshot = {
  phase: "idle",
  supported: nativeAvailable,
  runtimeInstalled: false,
  models: [
    {
      id: "small-q5_1",
      label: "Small (Q5_1)",
      description: "Recommended for Indonesian + English accuracy",
      approxBytes: 190_000_000,
      installed: false,
      recommended: true,
    },
    {
      id: "base-q5_1",
      label: "Base (Q5_1)",
      description: "Faster and lighter on CPU",
      approxBytes: 60_000_000,
      installed: false,
      recommended: false,
    },
  ],
  activeModel: "small-q5_1",
  download: null,
  transcript: null,
  transcriptSeq: 0,
  error: null,
};

export function useVoice({
  onTranscript,
  onModelRequired,
}: {
  onTranscript?: (text: string, autoSend: boolean) => void;
  onModelRequired?: () => void;
} = {}): VoiceViewModel {
  const [snapshot, setSnapshot] = useState<VoiceSnapshot>(initialSnapshot);
  const [prefs, setPrefs] = useState<VoicePreferences>(() => readVoicePreferences());
  const [level, setLevel] = useState(0);
  const lastTranscriptSeq = useRef<number | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const speech = useSpeechOutput(prefs);
  const lastTurnWasVoiceRef = useRef(false);

  const updatePrefs = useCallback((patch: Partial<VoicePreferences>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      writeVoicePreferences(next);
      return next;
    });
  }, []);

  const acceptSnapshot = useCallback((next: VoiceSnapshot) => {
    setSnapshot(next);
    if (next.phase !== "listening") setLevel(0);
    if (lastTranscriptSeq.current === null) {
      lastTranscriptSeq.current = next.transcriptSeq;
      return;
    }
    if (
      next.transcript &&
      next.transcriptSeq > lastTranscriptSeq.current &&
      next.transcript.trim().length > 0
    ) {
      lastTranscriptSeq.current = next.transcriptSeq;
      const autoSend = prefsRef.current.autoSend;
      if (autoSend) lastTurnWasVoiceRef.current = true;
      onTranscriptRef.current?.(next.transcript.trim(), autoSend);
    }
  }, []);

  const setErrorSnapshot = useCallback((error: string | null) => {
    setSnapshot((curr) => ({ ...curr, phase: error ? "error" : "idle", error }));
  }, []);

  const actions = useVoiceRuntimeActions({
    snapshotPhase: snapshot.phase,
    prefsRef,
    updatePrefs,
    acceptSnapshot,
    setErrorSnapshot,
    setLevel,
    stopSpeaking: speech.stopSpeaking,
    onModelRequired,
  });

  const events = useVoiceEvents({
    acceptSnapshot,
    setLevel,
    toggleRef: actions.toggleRef,
  });

  const activeModelInfo =
    snapshot.models.find((m) => m.id === prefs.modelId) ?? snapshot.models[0] ?? null;

  return {
    snapshot,
    prefs,
    updatePrefs,
    ...events,
    level,
    activeModelInfo,
    activeModelReady: Boolean(snapshot.runtimeInstalled && activeModelInfo?.installed),
    listening: snapshot.phase === "listening",
    transcribing: snapshot.phase === "transcribing",
    downloading: snapshot.phase === "downloading",
    downloadProgress: snapshot.download,
    ...actions,
    ...speech,
    noteVoiceSubmission: () => {
      lastTurnWasVoiceRef.current = true;
    },
  };
}
