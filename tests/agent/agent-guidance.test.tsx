import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { AssistantProfile, LearningMode } from "../../src/platform/tauri";
import { AgentComposer } from "../../src/features/agent/conversation/AgentComposer";
import { AgentHeader } from "../../src/features/agent/conversation/AgentHeader";
import { AgentTranscript } from "../../src/features/agent/transcript/AgentTranscript";
import { ProfileSettings } from "../../src/features/agent/settings/ProfileSettings";
import {
  emptyAssistantProfile,
  loadAssistantGuidance,
  saveAssistantGuidance,
} from "../../src/features/agent/model/assistant-profile";
import { matchingSlashModes, parseSlashMode } from "../../src/features/agent/model/learning-mode";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function ComposerHarness({
  initialMode = "direct",
  onEscapeBubble,
  onSend,
}: {
  initialMode?: LearningMode;
  onEscapeBubble?: () => void;
  onSend?: (draft: string, mode: LearningMode) => void;
}) {
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<LearningMode>(initialMode);
  return (
    <div onKeyDown={(event) => event.key === "Escape" && onEscapeBubble?.()}>
      <AgentComposer
        provider="codex"
        imageTransport
        captureSource="window"
        composerRef={{ current: null }}
        draft={draft}
        setDraft={setDraft}
        mode={mode}
        onModeChange={setMode}
        busy={false}
        captureBusy={false}
        capturePhase="idle"
        canSend={draft.trim().length > 0}
        stopping={false}
        onCapture={() => {}}
        send={async () => {
          onSend?.(draft, mode);
        }}
        stop={async () => {}}
      />
    </div>
  );
}

describe("Learning modes and slash commands", () => {
  test("parses curated slash commands and aliases cleanly", () => {
    expect(parseSlashMode("/solve find shortest path in DAG")).toEqual({
      mode: "solve",
      remainder: "find shortest path in DAG",
    });
    expect(parseSlashMode("/cp segment tree lazy propagation")).toEqual({
      mode: "solve",
      remainder: "segment tree lazy propagation",
    });
    expect(parseSlashMode("/math integrate x^2 dx")).toEqual({
      mode: "solve",
      remainder: "integrate x^2 dx",
    });
    expect(parseSlashMode("/mentor explain recursion")).toEqual({
      mode: "mentor",
      remainder: "explain recursion",
    });
    expect(parseSlashMode("/eli5 black holes")).toEqual({
      mode: "simple",
      remainder: "black holes",
    });
    expect(parseSlashMode("/quiz")).toEqual({ mode: "practice", remainder: "" });
    expect(parseSlashMode("/translate hello")).toEqual({ mode: "write", remainder: "hello" });
    expect(parseSlashMode("/unknown topic")).toBeNull();
    expect(matchingSlashModes("/m").map((option) => option.id)).toEqual(["mentor"]);
    expect(matchingSlashModes("/cp").map((option) => option.id)).toEqual(["solve"]);
    expect(matchingSlashModes("/ma").map((option) => option.id)).toEqual(["solve"]);
  });

  test("mode picker switches styles and Escape closes menu without collapsing notch", () => {
    let escaped = 0;
    render(<ComposerHarness onEscapeBubble={() => (escaped += 1)} />);

    const trigger = screen.getByRole("button", { name: /Learning mode: Direct/ });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(escaped).toBe(0);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Mentor/ }));
    expect(screen.getByRole("button", { name: /Learning mode: Mentor/ })).toBeTruthy();
  });

  test("typing slash opens menu, keyboard selects mode, and Escape does not bubble", () => {
    let escaped = 0;
    let sends = 0;
    render(
      <ComposerHarness
        onEscapeBubble={() => (escaped += 1)}
        onSend={() => {
          sends += 1;
        }}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Question for the selected agent" });
    fireEvent.change(input, { target: { value: "/s" } });
    expect(screen.getByRole("listbox")).toBeTruthy();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(escaped).toBe(0);
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.change(input, { target: { value: "/m" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(sends).toBe(0);
    expect((input as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByRole("button", { name: /Learning mode: Mentor/ })).toBeTruthy();
  });
});

describe("Header quick switcher popover", () => {
  test("switches engine, model, and effort inline and isolates Escape", () => {
    let escaped = 0;
    const picked: string[] = [];
    render(
      <div onKeyDown={(event) => event.key === "Escape" && (escaped += 1)}>
        <AgentHeader
          view="chat"
          provider="codex"
          model="gpt-5"
          thinkingEffort="medium"
          hasThread={false}
          resetBusy={false}
          onBack={() => {}}
          onSettings={() => picked.push("settings")}
          onHistory={() => {}}
          onNewSession={() => {}}
          gearRef={{ current: null }}
          runtimeSwitcher={{
            providers: [
              { id: "codex", displayName: "Codex", command: "codex", installed: true },
              { id: "claude", displayName: "Claude Code", command: "claude", installed: true },
              { id: "pi", displayName: "Pi", command: "pi", installed: false },
            ],
            readiness: {
              status: "ready",
              message: "",
              recovery: "",
              imageInput: true,
              imageTransport: true,
              model: "gpt-5",
              models: [
                {
                  id: "gpt-5",
                  displayName: "GPT-5",
                  contextWindow: 400_000,
                  imageInput: true,
                  thinkingEfforts: ["low", "medium", "high"],
                  defaultThinkingEffort: "medium",
                },
                {
                  id: "gpt-5-mini",
                  displayName: "GPT-5 Mini",
                  contextWindow: 200_000,
                  imageInput: true,
                  thinkingEfforts: ["low"],
                  defaultThinkingEffort: "low",
                },
              ],
              thinkingEffort: "medium",
              thinkingEfforts: ["low", "medium", "high"],
            },
            locked: false,
            onSelectProvider: (id) => picked.push(`provider:${id}`),
            onSelectModel: (id) => picked.push(`model:${id}`),
            onSelectThinkingEffort: (effort) => picked.push(`effort:${effort}`),
            onOpenSettings: () => picked.push("settings"),
          }}
        />
      </div>,
    );

    const trigger = screen.getByRole("button", { name: /Codex/ });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Switch AI engine and model" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pi" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Claude Code" }));
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "gpt-5-mini" } });
    fireEvent.click(screen.getByRole("button", { name: "High" }));
    expect(picked).toEqual(["provider:claude", "model:gpt-5-mini", "effort:high"]);

    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(escaped).toBe(0);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("Profile settings and empty state starters", () => {
  test("persists bounded assistant profile and clears cleanly", () => {
    saveAssistantGuidance({
      mode: "mentor",
      profile: {
        language: "Indonesian",
        level: "Beginner",
        instructions: "Use analogies",
      },
    });
    expect(loadAssistantGuidance()).toEqual({
      mode: "mentor",
      profile: { language: "Indonesian", level: "Beginner", instructions: "Use analogies" },
    });

    function ProfileHarness() {
      const [profile, setProfile] = useState<AssistantProfile>({ ...emptyAssistantProfile });
      return (
        <ProfileSettings
          profile={profile}
          onChange={setProfile}
          onClear={() => setProfile({ ...emptyAssistantProfile })}
        />
      );
    }
    render(<ProfileHarness />);
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Answer language"), {
      target: { value: "Indonesian" },
    });
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect((screen.getByLabelText("Answer language") as HTMLInputElement).value).toBe("");
  });

  test("empty state offers learning starters that select mode and prefill draft", () => {
    let draft = "";
    let mode: LearningMode = "direct";
    render(
      <AgentTranscript
        agent={{
          snapshot: {
            runId: 0,
            seq: 0,
            status: "idle",
            provider: "codex",
            threadId: null,
            model: "gpt-5",
            thinkingEffort: null,
            usage: null,
            messages: [],
            activity: [],
            capture: { requestId: 0, phase: "idle", error: null },
            error: null,
          },
          readiness: {
            status: "ready",
            message: "",
            recovery: "",
            imageInput: true,
            imageTransport: true,
            model: "gpt-5",
            models: [],
            thinkingEffort: null,
            thinkingEfforts: [],
          },
          draft,
          setDraft: (value) => {
            draft = value;
          },
          mode,
          setMode: (next) => {
            mode = next;
          },
          error: null,
          busy: false,
          captureBusy: false,
          send: async () => {},
          stop: async () => {},
          refreshProvider: async () => {},
          retryConnection: async () => {},
          clearError: () => {},
          errorKind: null,
        }}
        captureSource="window"
        captureShortcut="Ctrl+Alt+S"
        captureActionError={null}
        onCapture={() => {}}
        onConfigureCapture={() => {}}
        onMeasured={() => {}}
      />,
    );

    expect(screen.getByText(/What would you like to learn or figure out/)).toBeTruthy();
    expect(screen.getByText(/Ctrl\+Alt\+S/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Learn step by step/ }));
    expect(mode).toBe("mentor");
    expect(draft).toContain("Guide me step by step");
  });
});
