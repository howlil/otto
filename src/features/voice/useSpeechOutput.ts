import { useCallback, useEffect, useRef, useState } from "react";
import type { VoicePreferences } from "./preferences";
import { cleanMarkdownForSpeech, detectSpeechLocale } from "./speech-text";
import type { TtsVoiceOption } from "./view-model";

function getSpeechSynthesis(): SpeechSynthesis | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  return window.speechSynthesis ?? null;
}

function listAvailableVoices(synth: SpeechSynthesis | null): TtsVoiceOption[] {
  if (!synth || typeof synth.getVoices !== "function") return [];
  return synth
    .getVoices()
    .filter((voice) => Boolean(voice.voiceURI && voice.name))
    .map((voice) => ({
      uri: voice.voiceURI,
      name: voice.name,
      lang: voice.lang || "en-US",
    }));
}

function pickVoice(
  synth: SpeechSynthesis,
  preferredUri: string,
  locale: "id" | "en",
): SpeechSynthesisVoice | null {
  const voices = typeof synth.getVoices === "function" ? synth.getVoices() : [];
  if (voices.length === 0) return null;
  if (preferredUri && preferredUri !== "auto") {
    const exact = voices.find((v) => v.voiceURI === preferredUri);
    if (exact) return exact;
  }
  const targetPrefix = locale === "id" ? "id" : "en";
  return (
    voices.find((v) => v.lang?.toLowerCase().startsWith(targetPrefix)) ??
    voices.find((v) => v.default) ??
    voices[0] ??
    null
  );
}

export function useSpeechOutput(prefs: VoicePreferences) {
  const synth = getSpeechSynthesis();
  const ttsSupported = synth !== null && typeof SpeechSynthesisUtterance !== "undefined";
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [ttsVoices, setTtsVoices] = useState<TtsVoiceOption[]>(() => listAvailableVoices(synth));
  const activeIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!synth) return;
    const update = () => setTtsVoices(listAvailableVoices(synth));
    update();
    if (typeof synth.addEventListener === "function") {
      synth.addEventListener("voiceschanged", update);
      return () => synth.removeEventListener("voiceschanged", update);
    }
  }, [synth]);

  const stopSpeaking = useCallback(() => {
    activeIdRef.current = null;
    setSpeakingMessageId(null);
    try {
      synth?.cancel();
    } catch {}
  }, [synth]);

  const speakMessage = useCallback(
    (messageId: string, rawText: string) => {
      if (!synth || typeof SpeechSynthesisUtterance === "undefined") return;
      const cleaned = cleanMarkdownForSpeech(rawText, prefs.language);
      if (!cleaned) return;
      try {
        synth.cancel();
      } catch {}
      const locale = detectSpeechLocale(cleaned, prefs.language);
      const utterance = new SpeechSynthesisUtterance(cleaned);
      utterance.rate = prefs.ttsRate;
      utterance.lang = locale === "id" ? "id-ID" : "en-US";
      const matchedVoice = pickVoice(synth, prefs.ttsVoiceUri, locale);
      if (matchedVoice) utterance.voice = matchedVoice;
      activeIdRef.current = messageId;
      setSpeakingMessageId(messageId);
      const clearIfCurrent = () => {
        if (activeIdRef.current === messageId) {
          activeIdRef.current = null;
          setSpeakingMessageId(null);
        }
      };
      utterance.onend = clearIfCurrent;
      utterance.onerror = clearIfCurrent;
      try {
        synth.speak(utterance);
      } catch {
        clearIfCurrent();
      }
    },
    [prefs.language, prefs.ttsRate, prefs.ttsVoiceUri, synth],
  );

  const toggleSpeakMessage = useCallback(
    (messageId: string, rawText: string) => {
      if (activeIdRef.current === messageId) {
        stopSpeaking();
        return;
      }
      speakMessage(messageId, rawText);
    },
    [speakMessage, stopSpeaking],
  );

  useEffect(() => () => stopSpeaking(), [stopSpeaking]);

  return {
    ttsSupported,
    ttsVoices,
    speaking: speakingMessageId !== null,
    speakingMessageId,
    speakMessage,
    stopSpeaking,
    toggleSpeakMessage,
  };
}
