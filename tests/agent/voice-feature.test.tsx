import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { AgentCircle } from "../../src/features/agent/capsule/AgentCircle";
import { AssistantTurnActions } from "../../src/features/agent/transcript/TurnActions";
import {
  cleanMarkdownForSpeech,
  ComposerMicControl,
  defaultVoicePreferences,
  detectSpeechLocale,
  readVoicePreferences,
  recordVoiceShortcut,
  VoiceSettings,
  writeVoicePreferences,
  type VoiceViewModel,
} from "../../src/features/voice";
import type { AgentSnapshot, ProviderReadiness } from "../../src/platform/tauri";

afterEach(cleanup);

const baseSnapshot: AgentSnapshot = {
  runId: 1,
  seq: 1,
  status: "idle",
  provider: "codex",
  conversationId: "conv-1",
  threadId: null,
  model: "gpt-5-codex",
  thinkingEffort: null,
  usage: null,
  messages: [],
  activities: [],
  thinkingText: "",
  pendingPermission: null,
  queuedFollowup: null,
  capture: {
    requestId: 0,
    phase: "idle",
    source: "window",
    shortcut: "Ctrl+Shift+O",
    textShortcut: "Ctrl+Alt+S",
    autoSend: false,
    staged: null,
    error: null,
  },
  error: null,
};

const ready: ProviderReadiness = {
  status: "ready",
  message: "Ready",
  recovery: "",
  imageInput: true,
  imageTransport: true,
  model: "gpt-5-codex",
  models: [],
  thinkingEffort: null,
  thinkingEfforts: [],
  rateLimits: null,
};

function makeVoiceModel(overrides: Partial<VoiceViewModel> = {}): VoiceViewModel {
  return {
    snapshot: {
      phase: "idle",
      supported: true,
      runtimeInstalled: true,
      models: [
        {
          id: "small-q5_1",
          label: "Small (Q5_1)",
          description: "Recommended for Indonesian + English accuracy",
          approxBytes: 190_000_000,
          installed: true,
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
    },
    prefs: { ...defaultVoicePreferences },
    updatePrefs: () => {},
    devices: [{ id: "default", name: "System default microphone", isDefault: true }],
    refreshDevices: async () => {},
    shortcut: "Ctrl+Alt+V",
    shortcutMessage: "",
    shortcutBusy: false,
    saveShortcut: async () => {},
    level: 0,
    activeModelInfo: null,
    activeModelReady: true,
    listening: false,
    transcribing: false,
    downloading: false,
    downloadProgress: null,
    toggleRecording: async () => {},
    startRecording: async () => {},
    stopRecording: async () => {},
    cancelVoice: async () => {},
    downloadModel: async () => {},
    cancelDownload: async () => {},
    deleteModel: async () => {},
    speaking: false,
    speakingMessageId: null,
    ttsSupported: true,
    ttsVoices: [{ uri: "ms-gadis", name: "Microsoft Gadis", lang: "id-ID" }],
    speakMessage: () => {},
    stopSpeaking: () => {},
    toggleSpeakMessage: () => {},
    noteVoiceSubmission: () => {},
    ...overrides,
  };
}

describe("Voice input and speech output", () => {
  test("cleans markdown and summarizes code blocks for natural speech", () => {
    const idMarkdown =
      "### Penjelasan Rekursi\nFungsi yang memanggil dirinya sendiri di dalam kode ini:\n```python\ndef fact(n):\n  return 1\n```\nLihat [dokumentasi](https://example.com) untuk `fact(n)`.";
    expect(detectSpeechLocale(idMarkdown, "auto")).toBe("id");
    const cleanedId = cleanMarkdownForSpeech(idMarkdown, "auto");
    expect(cleanedId).toContain("Penjelasan Rekursi");
    expect(cleanedId).toContain("Contoh kode python.");
    expect(cleanedId).not.toContain("def fact");
    expect(cleanedId).not.toContain("https://example.com");

    const enMarkdown =
      "Here is a quick overview:\n```ts\nconst x = 1;\n```\nUse **bold** text carefully.";
    const cleanedEn = cleanMarkdownForSpeech(enMarkdown, "en");
    expect(cleanedEn).toContain("ts code example.");
    expect(cleanedEn).not.toContain("const x = 1");
    expect(cleanedEn).toContain("Use bold text carefully.");
  });

  test("persists and validates voice preferences", () => {
    localStorage.clear();
    expect(readVoicePreferences()).toEqual(defaultVoicePreferences);
    writeVoicePreferences({
      ...defaultVoicePreferences,
      modelId: "base-q5_1",
      language: "id",
      autoSend: true,
      readAloudMode: "voice-only",
      ttsRate: 1.25,
    });
    const loaded = readVoicePreferences();
    expect(loaded.modelId).toBe("base-q5_1");
    expect(loaded.language).toBe("id");
    expect(loaded.autoSend).toBe(true);
    expect(loaded.readAloudMode).toBe("voice-only");
    expect(loaded.ttsRate).toBe(1.25);

    expect(
      recordVoiceShortcut({
        code: "KeyV",
        ctrlKey: true,
        altKey: true,
        shiftKey: false,
        metaKey: false,
      }),
    ).toEqual({ kind: "accepted", shortcut: "Ctrl+Alt+V" });
  });

  test("AgentCircle handles listening stop on click and cancel/mute on right-click", () => {
    let stoppedListening = 0;
    let cancelledListening = 0;
    let stoppedSpeaking = 0;
    let opened = 0;

    const { rerender } = render(
      <AgentCircle
        snapshot={baseSnapshot}
        installed={true}
        readiness={ready}
        error={null}
        voice={{
          listening: true,
          level: 0.6,
          onStopListening: () => {
            stoppedListening += 1;
          },
          onCancelListening: () => {
            cancelledListening += 1;
          },
        }}
        buttonRef={createRef()}
        onOpen={() => {
          opened += 1;
        }}
      />,
    );

    const button = screen.getByRole("button", { name: /Open Agent/ });
    fireEvent.click(button);
    expect(stoppedListening).toBe(1);
    expect(opened).toBe(0);

    fireEvent.contextMenu(button);
    expect(cancelledListening).toBe(1);

    rerender(
      <AgentCircle
        snapshot={baseSnapshot}
        installed={true}
        readiness={ready}
        error={null}
        voice={{
          speaking: true,
          onStopSpeaking: () => {
            stoppedSpeaking += 1;
          },
        }}
        buttonRef={createRef()}
        onOpen={() => {
          opened += 1;
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Open Agent/ }));
    expect(opened).toBe(1);

    fireEvent.contextMenu(screen.getByRole("button", { name: /Open Agent/ }));
    expect(stoppedSpeaking).toBe(1);
  });

  test("ComposerMicControl and TurnActions Listen button trigger voice callbacks", () => {
    let toggledMic = 0;
    let openedSettings = 0;
    let toggledSpeak = "";

    const { rerender } = render(
      <ComposerMicControl
        voice={makeVoiceModel({
          activeModelReady: false,
        })}
        disabled={false}
        onOpenVoiceSettings={() => {
          openedSettings += 1;
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Set up voice input" }));
    expect(openedSettings).toBe(1);

    rerender(
      <ComposerMicControl
        voice={makeVoiceModel({
          activeModelReady: true,
          toggleRecording: async () => {
            toggledMic += 1;
          },
        })}
        disabled={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Voice input" }));
    expect(toggledMic).toBe(1);

    render(
      <AssistantTurnActions
        messageId="1:assistant"
        text="Jawaban singkat"
        isLatest={true}
        stoppedPartial={false}
        canAct={true}
        showFollowupChips={false}
        speaking={false}
        onToggleSpeak={(id, txt) => {
          toggledSpeak = `${id}:${txt}`;
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    expect(toggledSpeak).toBe("1:assistant:Jawaban singkat");
  });

  test("VoiceSettings renders model download, input controls, and read-aloud options", () => {
    let downloadedModel = "";
    render(
      <VoiceSettings
        voice={makeVoiceModel({
          downloadModel: async (id) => {
            downloadedModel = id ?? "default";
          },
        })}
      />,
    );

    expect(screen.getByText("Small (Q5_1)")).toBeTruthy();
    expect(screen.getByText("Base (Q5_1)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(downloadedModel).toBe("base-q5_1");
    expect(screen.getByText("Auto-stop on silence")).toBeTruthy();
    expect(screen.getByText("Auto-send voice")).toBeTruthy();
    expect(screen.getByText("Auto-read answers")).toBeTruthy();
  });
});
