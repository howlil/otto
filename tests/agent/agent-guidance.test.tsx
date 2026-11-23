import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { AssistantProfile, LearningMode } from "../../src/platform/tauri";
import { AgentComposer } from "../../src/features/agent/conversation/AgentComposer";
import { AgentHeader } from "../../src/features/agent/conversation/AgentHeader";
import { AgentPanel } from "../../src/features/agent/conversation/AgentPanel";
import { AgentTranscript } from "../../src/features/agent/transcript/AgentTranscript";
import { ProfileSettings } from "../../src/features/agent/settings/ProfileSettings";
import { AgentOnboardingCard } from "../../src/features/agent/onboarding/AgentOnboardingCard";
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

describe("Profile settings, onboarding, and empty state starters", () => {
  test("persists bounded assistant profile, migrates legacy profiles, and clears cleanly", () => {
    expect(loadAssistantGuidance()).toEqual({
      mode: "direct",
      profile: { ...emptyAssistantProfile },
      onboardingCompleted: false,
    });

    localStorage.setItem(
      "otto.assistant-guidance.v1",
      JSON.stringify({
        mode: "mentor",
        profile: { language: "Indonesian", level: "Beginner", instructions: "Use analogies" },
      }),
    );
    expect(loadAssistantGuidance()).toEqual({
      mode: "mentor",
      profile: {
        name: "",
        role: "",
        focus: "",
        language: "Indonesian",
        level: "Beginner",
        instructions: "Use analogies",
      },
      onboardingCompleted: true,
    });

    saveAssistantGuidance({
      mode: "mentor",
      profile: {
        name: "Lili",
        role: "Developer",
        focus: "Rust, TypeScript",
        language: "Bahasa Indonesia",
        level: "Concise & direct",
        instructions: "Use analogies",
      },
      onboardingCompleted: true,
    });
    expect(loadAssistantGuidance()).toEqual({
      mode: "mentor",
      profile: {
        name: "Lili",
        role: "Developer",
        focus: "Rust, TypeScript",
        language: "Bahasa Indonesia",
        level: "Concise & direct",
        instructions: "Use analogies",
      },
      onboardingCompleted: true,
    });

    let startedOnboarding = 0;
    function ProfileHarness() {
      const [profile, setProfile] = useState<AssistantProfile>({ ...emptyAssistantProfile });
      return (
        <ProfileSettings
          profile={profile}
          onChange={setProfile}
          onClear={() => setProfile({ ...emptyAssistantProfile })}
          onStartOnboarding={() => {
            startedOnboarding += 1;
          }}
        />
      );
    }
    render(<ProfileHarness />);
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Setup guide" }));
    expect(startedOnboarding).toBe(1);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Lili" } });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "Developer" } });
    fireEvent.change(screen.getByLabelText("Focus & interests"), { target: { value: "Rust" } });
    fireEvent.change(screen.getByLabelText("Answer language"), {
      target: { value: "Indonesian" },
    });
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Role") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Answer language") as HTMLInputElement).value).toBe("");
  });

  test("interactive 3-step onboarding captures user identity, focus, language, and style", () => {
    const completed: AssistantProfile[] = [];
    let skipped = 0;
    let closed = 0;
    let escaped = 0;

    const view = render(
      <div onKeyDown={(event) => event.key === "Escape" && (escaped += 1)}>
        <AgentOnboardingCard
          reducedMotion
          onComplete={(profile) => completed.push(profile)}
          onSkip={() => {
            skipped += 1;
          }}
          onClose={() => {
            closed += 1;
          }}
        />
      </div>,
    );

    expect(document.activeElement).toBe(document.body);
    fireEvent.change(screen.getByLabelText("What should Otto call you?"), {
      target: { value: "Lili" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Developer" }));
    expect((screen.getByLabelText("Or describe your role") as HTMLInputElement).value).toBe(
      "Developer",
    );
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: "Algorithms & CP" }));
    fireEvent.click(screen.getByRole("button", { name: "Backend & systems" }));
    expect((screen.getByLabelText("Topics, subjects, or work you focus on") as HTMLInputElement).value).toBe(
      "Algorithms & CP, Backend & systems",
    );
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: "Bahasa Indonesia" }));
    fireEvent.click(screen.getByRole("button", { name: /Concise & direct/ }));
    expect(
      screen.getByText(/Personalizing prompts for: Lili · Developer · Bahasa Indonesia/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));

    expect(completed).toEqual([
      {
        name: "Lili",
        role: "Developer",
        focus: "Algorithms & CP, Backend & systems",
        language: "Bahasa Indonesia",
        level: "Concise & direct",
        instructions: "",
      },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(skipped).toBe(1);

    view.rerender(
      <div onKeyDown={(event) => event.key === "Escape" && (escaped += 1)}>
        <AgentOnboardingCard
          key="reopen"
          initialProfile={completed[0]}
          forcedOpen
          reducedMotion
          onComplete={(profile) => completed.push(profile)}
          onSkip={() => {
            skipped += 1;
          }}
          onClose={() => {
            closed += 1;
          }}
        />
      </div>,
    );
    const nameInput = screen.getByLabelText("What should Otto call you?") as HTMLInputElement;
    expect(nameInput.value).toBe("Lili");
    fireEvent.keyDown(nameInput, { key: "Escape" });
    expect(closed).toBe(1);
    expect(escaped).toBe(0);
  });

  test("AgentTranscript renders first-run onboarding above composer and transitions to personalized empty state", () => {
    function TranscriptOnboardingHarness() {
      const [profile, setProfile] = useState<AssistantProfile>({ ...emptyAssistantProfile });
      const [pending, setPending] = useState(true);
      const [open, setOpen] = useState(false);
      const [draft, setDraft] = useState("");
      return (
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
            setDraft,
            profile,
            onboardingPending: pending,
            onboardingOpen: open,
            completeOnboarding: (next) => {
              setProfile(next);
              setPending(false);
              setOpen(false);
            },
            skipOnboarding: () => {
              setPending(false);
              setOpen(false);
            },
            openOnboarding: () => setOpen(true),
            closeOnboarding: () => setOpen(false),
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
          captureActionError={null}
          reducedMotion
          onCapture={() => {}}
          onConfigureCapture={() => {}}
          onMeasured={() => {}}
        />
      );
    }

    render(<TranscriptOnboardingHarness />);
    expect(screen.getByRole("heading", { name: "Let Otto get to know you" })).toBeTruthy();
    expect(document.getElementById("otto-prompt")).not.toBeNull();

    fireEvent.change(screen.getByLabelText("What should Otto call you?"), {
      target: { value: "Budi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Student" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));

    expect(screen.queryByRole("heading", { name: "Let Otto get to know you" })).toBeNull();
    expect(screen.queryByText(/what would you like to figure out/i)).toBeNull();
    expect(screen.queryByText(/Tailored for/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit profile" })).toBeNull();
    expect(screen.getByRole("button", { name: /Learn step by step/ })).toBeTruthy();
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
        captureActionError={null}
        onCapture={() => {}}
        onConfigureCapture={() => {}}
        onMeasured={() => {}}
      />,
    );

    expect(screen.queryByText(/What would you like to learn or figure out/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Learn step by step/ }));
    expect(mode).toBe("mentor");
    expect(draft).toContain("Guide me step by step");
  });

  test("opening header or mode popovers expands measured panel height to prevent clipping and restores on close", () => {
    const measured: number[] = [];
    const originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight",
    );
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        const role = (this as HTMLElement).getAttribute?.("role");
        if (role === "dialog") return 340;
        if (role === "menu") return 290;
        return 120;
      },
    });
    try {
      render(
        <AgentPanel
          agent={{
            snapshot: {
              runId: 0,
              seq: 0,
              status: "idle",
              provider: "codex",
              threadId: null,
              model: "gpt-5",
              thinkingEffort: "high",
              usage: null,
              rateLimits: [],
              messages: [],
              activity: [],
              capture: { requestId: 0, phase: "idle", error: null },
              error: null,
            },
            installed: true,
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
                  thinkingEfforts: ["low", "high"],
                  defaultThinkingEffort: "high",
                },
              ],
              thinkingEffort: "high",
              thinkingEfforts: ["low", "high"],
            },
            providers: [{ id: "codex", displayName: "Codex", command: "codex", installed: true }],
            history: {
              items: [],
              loading: false,
              pending: false,
              error: null,
              refresh: async () => {},
              open: async () => true,
              rename: async () => true,
              remove: async () => true,
              removeAll: async () => true,
              search: async () => {},
              exportMarkdown: async () => "",
            },
            draft: "",
            setDraft: () => {},
            provider: "codex",
            model: "gpt-5",
            thinkingEffort: "high",
            setProvider: () => {},
            setModel: () => {},
            setThinkingEffort: () => {},
            mode: "direct",
            setMode: () => {},
            locked: false,
            error: null,
            busy: false,
            captureBusy: false,
            captureNow: async () => {},
            send: async () => {},
            stop: async () => {},
            newSession: async () => {},
            refreshProvider: async () => {},
            retryConnection: async () => {},
            clearError: () => {},
            errorKind: null,
          }}
          settingsButtonRef={{ current: null }}
          onSettings={() => {}}
          onConfigureCapture={() => {}}
          onMeasured={(height) => measured.push(height)}
          reducedMotion
        />,
      );

      const baseHeight = measured.at(-1) ?? 0;
      fireEvent.click(screen.getByRole("button", { name: /Codex/ }));
      const withHeaderPopover = measured.at(-1) ?? 0;
      expect(withHeaderPopover).toBeGreaterThanOrEqual(410);
      expect(withHeaderPopover).toBeGreaterThan(baseHeight);

      fireEvent.keyDown(document, { key: "Escape" });
      expect(measured.at(-1)).toBe(baseHeight);

      fireEvent.click(screen.getByRole("button", { name: /Learning mode: Direct/ }));
      const withModeMenu = measured.at(-1) ?? 0;
      expect(withModeMenu).toBeGreaterThanOrEqual(370);
      expect(withModeMenu).toBeGreaterThan(baseHeight);

      fireEvent.keyDown(document, { key: "Escape" });
      expect(measured.at(-1)).toBe(baseHeight);
    } finally {
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
      } else {
        delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
      }
    }
  });
});
