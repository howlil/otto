import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AgentCapsule } from "../../src/features/agent/capsule/AgentCapsule";
import { AgentTranscript } from "../../src/features/agent/transcript/AgentTranscript";
import { ProviderSettings } from "../../src/features/agent/settings/ProviderSettings";
import { ModelUsageSettings } from "../../src/features/agent/settings/ModelUsageSettings";
import { EngineQuickPopover } from "../../src/features/agent/conversation/EngineQuickPopover";
import { EngineQuickSwitcher } from "../../src/features/agent/conversation/EngineQuickSwitcher";
import { formatResetTime, resolveRateLimits } from "../../src/features/agent/model/rate-limits";

const snapshot = (overrides = {}) => ({
  runId: 1,
  seq: 1,
  status: "idle",
  provider: "codex",
  threadId: null,
  model: "gpt-5-codex",
  thinkingEffort: "high",
  usage: null,
  messages: [],
  activity: [],
  capture: { requestId: 0, phase: "idle", error: null },
  error: null,
  ...overrides,
});

const readiness = (overrides = {}) => ({
  status: "ready",
  message: "Codex is ready.",
  recovery: "",
  imageInput: false,
  imageTransport: false,
  model: "gpt-5-codex",
  models: [],
  thinkingEffort: "high",
  thinkingEfforts: ["low", "high"],
  ...overrides,
});

const transcriptModel = (overrides = {}) => ({
  snapshot: snapshot(),
  readiness: readiness(),
  draft: "Why does ownership matter?",
  setDraft: () => {},
  error: null,
  busy: false,
  captureBusy: false,
  send: async () => {},
  stop: async () => {},
  refreshProvider: async () => {},
  retryConnection: async () => {},
  clearError: () => {},
  errorKind: null,
  ...overrides,
});

const transcript = (overrides = {}) => {
  const model = transcriptModel(overrides);
  return render(
    <AgentTranscript
      agent={model}
      onConfigureCapture={() => {}}
      onCapture={() => {}}
      captureActionError={null}
      onMeasured={() => {}}
    />,
  );
};

const capsule = (snapshotOverrides = {}, readinessOverrides = {}) =>
  render(
    <AgentCapsule
      snapshot={snapshot(snapshotOverrides)}
      installed
      readiness={readiness(readinessOverrides)}
      error={null}
      buttonRef={{ current: null }}
      onOpen={() => {}}
    />,
  );

const sendButton = () => screen.getByRole("button", { name: "Send prompt" });

afterEach(cleanup);

describe("Agent readiness surfaced through the rendered chat", () => {
  test("OpenCode is selectable alongside existing providers and respects run locking", () => {
    const selected: string[] = [];
    const props = {
      readiness: readiness(), providerStatus: "Ready", onRetry: () => {},
      providers: [
        { id: "codex" as const, displayName: "Codex", command: "codex", installed: true },
        { id: "agy" as const, displayName: "Agy", command: "agy", installed: true },
        { id: "pi" as const, displayName: "Pi", command: "pi", installed: true },
        { id: "opencode" as const, displayName: "OpenCode", command: "opencode", installed: true },
        { id: "claude" as const, displayName: "Claude Code", command: "claude", installed: true },
      ],
      provider: "opencode" as const, onSelect: (provider: string) => selected.push(provider),
      locked: false,
    };
    const view = render(<ProviderSettings {...props} />);
    const button = screen.getByRole("button", { name: /^OpenCode/ });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /^Codex/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Antigravity/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Pi/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Claude Code/ })).toBeTruthy();
    fireEvent.click(button);
    expect(selected).toEqual(["opencode"]);
    view.rerender(<ProviderSettings {...props} locked />);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(selected).toEqual(["opencode"]);
  });

  test("OpenCode compact identity is not mislabeled as Codex", () => {
    capsule({ provider: "opencode" });
    const compact = screen.getByRole("button", { name: /OpenCode/ });
    expect(compact).toBeTruthy();
    expect(compact.querySelector("[data-otto-logo]")).not.toBeNull();
  });

  test("a ready provider exposes a model catalog refresh next to the model list", () => {
    let refreshes = 0;
    render(
      <ModelUsageSettings
        readiness={readiness()}
        snapshot={{ usage: null, model: null } as never}
        model={null}
        setModel={() => {}}
        thinkingEffort={null}
        setThinkingEffort={() => {}}
        busy={false}
        onRetry={() => {
          refreshes += 1;
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh models" }));
    expect(refreshes).toBe(1);
  });

  test("providers that are not installed are explained with the next step", () => {
    let refreshes = 0;
    render(
      <ProviderSettings
        readiness={readiness()}
        providers={[
          { id: "codex" as const, displayName: "Codex", command: "codex", installed: true },
          { id: "opencode" as const, displayName: "OpenCode", command: "opencode", installed: false },
        ]}
        providerStatus="Ready"
        onRetry={() => {
          refreshes += 1;
        }}
        provider="codex"
        onSelect={() => {}}
        locked={false}
      />,
    );
    expect(screen.queryByText(/Install the engine on this PC/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Not installed (1)" }));
    expect(screen.getByRole("button", { name: /^OpenCode/ })).toBeTruthy();
    expect(screen.getByText(/Install the engine on this PC/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(refreshes).toBe(1);
  });

  test("Check again re-scans live PATH and stays disabled while locked", () => {
    let pathRefreshes = 0;
    const props = {
      readiness: readiness(),
      providers: [
        { id: "codex" as const, displayName: "Codex", command: "codex", installed: true },
      ],
      providerStatus: "Ready",
      onRetry: () => {},
      onRefreshPath: () => {
        pathRefreshes += 1;
      },
      provider: "codex" as const,
      onSelect: () => {},
      locked: false,
    };
    const view = render(<ProviderSettings {...props} />);
    const button = screen.getByRole("button", { name: "Check again" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(pathRefreshes).toBe(1);

    view.rerender(<ProviderSettings {...props} locked />);
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(pathRefreshes).toBe(1);
  });

  test("an expired sign-in is reported with recovery instead of a ready claim", () => {
    transcript({
      readiness: readiness({
        status: "authRequired",
        message: "Codex needs sign-in.",
        recovery: "Run codex login, then Retry.",
      }),
    });
    expect(screen.getByText("Sign in required")).toBeTruthy();
    expect(screen.getByText(/Run codex login, then Retry\./)).toBeTruthy();
    expect((sendButton() as HTMLButtonElement).disabled).toBe(true);
  });

  test("a missing provider is reported as unavailable and blocks sending", () => {
    transcript({
      readiness: readiness({
        status: "missing",
        message: "Codex is not installed.",
        recovery: "Install the Codex CLI, then Retry.",
      }),
    });
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.getByText(/Install the Codex CLI, then Retry\./)).toBeTruthy();
    expect((sendButton() as HTMLButtonElement).disabled).toBe(true);
  });

  test("retry re-probes the provider readiness exactly once", () => {
    let retries = 0;
    transcript({
      readiness: readiness({ status: "unsupported", message: "Codex is too old.", recovery: "" }),
      refreshProvider: async () => {
        retries += 1;
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retries).toBe(1);
  });

  test("a lost Otto connection offers reconnect instead of a provider retry", () => {
    let reconnects = 0;
    transcript({
      error: "Cannot connect to the Otto desktop process.",
      errorKind: "connection",
      retryConnection: async () => {
        reconnects += 1;
      },
    });
    expect(screen.getByText("Otto connection unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(reconnects).toBe(1);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  test("a native run failure is shown as a request failure with draft recovery", () => {
    transcript({
      snapshot: snapshot({
        status: "failed",
        error: "The provider exited before returning an answer.",
      }),
    });
    expect(screen.getByText("Request failed")).toBeTruthy();
    expect(screen.getByText(/provider exited before returning an answer/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});

describe("Agent compact capsule state", () => {
  test("a finished background answer is announced without opening the chat", () => {
    capsule({ status: "completed", messages: [{ id: "1:assistant", role: "assistant", text: "Done" }] });
    expect(screen.getByText("Answer ready")).toBeTruthy();
  });

  test("an expired sign-in is visible in the compact capsule", () => {
    capsule({ status: "idle" }, { status: "authRequired" });
    expect(screen.getByText("Sign in required")).toBeTruthy();
    expect(screen.queryByText("Answer ready")).toBeNull();
  });

  test("ModelUsageSettings displays session usage when readiness model is provider-managed", () => {
    render(
      <ModelUsageSettings
        readiness={readiness({ model: null, models: [] })}
        snapshot={snapshot({
          provider: "claude",
          model: null,
          usage: {
            contextTokens: 1200,
            sessionTokens: 1500,
            inputTokens: 1000,
            cachedInputTokens: 200,
            outputTokens: 300,
            reasoningOutputTokens: null,
            modelContextWindow: 10000,
          },
        })}
        model={null}
        setModel={() => {}}
        thinkingEffort={null}
        setThinkingEffort={() => {}}
        busy={false}
      />,
    );
    expect(screen.getByText("1.5K")).toBeTruthy();
  });

  test("ModelUsageSettings omits thinking effort for non-thinking models and surfaces native model limits", () => {
    render(
      <ModelUsageSettings
        readiness={readiness({
          model: "gemini-pro-orchestrator-neon",
          models: [
            {
              id: "gemini-pro-orchestrator-neon",
              displayName: "Orchestrator (Neon)",
              contextWindow: 1_000_000,
              imageInput: true,
              thinkingEfforts: [],
              defaultThinkingEffort: null,
            },
          ],
          thinkingEffort: null,
          thinkingEfforts: [],
        })}
        snapshot={snapshot({ provider: "agy", model: "gemini-pro-orchestrator-neon", usage: null })}
        model="gemini-pro-orchestrator-neon"
        setModel={() => {}}
        thinkingEffort={null}
        setThinkingEffort={() => {}}
        busy={false}
      />,
    );
    expect(screen.queryByText("Thinking effort") === null).toBe(true);
    expect(screen.queryByText("Provider-managed") === null).toBe(true);
    expect(screen.getByText(/1M context/)).toBeTruthy();
    expect(screen.getByText(/Vision/)).toBeTruthy();
  });

  test("ModelUsageSettings shows checking state without fallback noise and adapts to >6 thinking levels", () => {
    const picked: Array<string | null> = [];
    const view = render(
      <ModelUsageSettings
        readiness={readiness({
          status: "checking",
          model: null,
          models: [],
          thinkingEffort: null,
          thinkingEfforts: [],
        })}
        snapshot={snapshot({ provider: "agy", model: null, usage: null })}
        model={null}
        setModel={() => {}}
        thinkingEffort={null}
        setThinkingEffort={(effort) => picked.push(effort)}
        busy={false}
      />,
    );
    expect(screen.getByText("Checking available models…")).toBeTruthy();
    expect(screen.queryByText("Engine default") === null).toBe(true);
    expect(screen.queryByText("Thinking effort") === null).toBe(true);

    const manyEfforts = ["off", "minimal", "low", "medium", "high", "xhigh", "ultra"];
    view.rerender(
      <ModelUsageSettings
        readiness={readiness({
          model: "deep-model",
          models: [
            {
              id: "deep-model",
              displayName: "Deep Model",
              contextWindow: 500_000,
              imageInput: false,
              thinkingEfforts: manyEfforts,
              defaultThinkingEffort: "medium",
            },
          ],
          thinkingEffort: "high",
          thinkingEfforts: manyEfforts,
        })}
        snapshot={snapshot({ provider: "pi", model: "deep-model", usage: null })}
        model="deep-model"
        setModel={() => {}}
        thinkingEffort={null}
        setThinkingEffort={(effort) => picked.push(effort)}
        busy={false}
      />,
    );
    const select = screen.getByLabelText("Thinking effort") as HTMLSelectElement;
    expect(select.value).toBe("high");
    fireEvent.change(select, { target: { value: "ultra" } });
    expect(picked).toEqual(["ultra"]);
  });

  test("ModelUsageSettings renders native thinking levels as one-click chips and selects exact native values", () => {
    const picked: Array<string | null> = [];
    const view = render(
      <ModelUsageSettings
        readiness={readiness({
          model: "gpt-5.6-sol",
          models: [
            {
              id: "gpt-5.6-sol",
              displayName: "GPT-5.6-Sol",
              contextWindow: 400_000,
              imageInput: true,
              thinkingEfforts: ["low", "medium", "high", "xhigh", "ultra"],
              defaultThinkingEffort: "high",
            },
          ],
          thinkingEffort: "high",
          thinkingEfforts: ["low", "medium", "high", "xhigh", "ultra"],
        })}
        snapshot={snapshot({ provider: "codex", model: "gpt-5.6-sol", usage: null })}
        model="gpt-5.6-sol"
        setModel={() => {}}
        thinkingEffort="high"
        setThinkingEffort={(effort) => picked.push(effort)}
        busy={false}
      />,
    );
    expect(screen.getByRole("button", { name: "High" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Extra high" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ultra" }));
    expect(picked).toEqual(["ultra"]);

    view.rerender(
      <ModelUsageSettings
        readiness={readiness({
          model: "gpt-5.6-sol",
          models: [
            {
              id: "gpt-5.6-sol",
              displayName: "GPT-5.6-Sol",
              contextWindow: 400_000,
              imageInput: true,
              thinkingEfforts: ["low", "medium", "high", "xhigh", "ultra"],
              defaultThinkingEffort: "high",
            },
          ],
          thinkingEffort: "high",
          thinkingEfforts: ["low", "medium", "high", "xhigh", "ultra"],
        })}
        snapshot={snapshot({ provider: "codex", model: "gpt-5.6-sol", usage: null })}
        model="gpt-5.6-sol"
        setModel={() => {}}
        thinkingEffort="high"
        setThinkingEffort={(effort) => picked.push(effort)}
        busy
      />,
    );
    expect((screen.getByRole("button", { name: "Ultra" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("ModelUsageSettings adapts usage display without showing Unavailable filler rows", () => {
    const view = render(
      <ModelUsageSettings
        readiness={readiness({ model: null, models: [], thinkingEffort: null, thinkingEfforts: [] })}
        snapshot={snapshot({
          provider: "opencode",
          model: null,
          usage: {
            contextTokens: null,
            sessionTokens: 1500,
            inputTokens: 1200,
            cachedInputTokens: 0,
            outputTokens: 300,
            reasoningOutputTokens: null,
            modelContextWindow: null,
          },
        })}
        model={null}
        setModel={() => {}}
        thinkingEffort={null}
        setThinkingEffort={() => {}}
        busy={false}
      />,
    );
    expect(screen.getByText("1.5K")).toBeTruthy();
    expect(screen.queryByText("Unavailable")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();

    view.rerender(
      <ModelUsageSettings
        readiness={readiness({
          model: "gpt-5.6-sol",
          models: [
            {
              id: "gpt-5.6-sol",
              displayName: "GPT-5.6-Sol",
              contextWindow: 1_000_000,
              imageInput: true,
              thinkingEfforts: ["low", "high"],
              defaultThinkingEffort: "high",
            },
          ],
        })}
        snapshot={snapshot({
          provider: "codex",
          model: "gpt-5.6-sol",
          usage: {
            contextTokens: 200_000,
            sessionTokens: 250_000,
            inputTokens: 150_000,
            cachedInputTokens: 50_000,
            outputTokens: 40_000,
            reasoningOutputTokens: 10_000,
            modelContextWindow: 1_000_000,
          },
        })}
        model="gpt-5.6-sol"
        setModel={() => {}}
        thinkingEffort="high"
        setThinkingEffort={() => {}}
        busy={false}
      />,
    );
    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(screen.getByText("20%")).toBeTruthy();
    expect(screen.getByText("Reasoning")).toBeTruthy();
    expect(screen.getByText("Cached")).toBeTruthy();
    expect(screen.queryByText("Unavailable")).toBeNull();
  });

  test("compact circle mode signals state transitions with motion cues, inner ring, and semantic pip", () => {
    const view = render(
      <AgentCapsule
        snapshot={snapshot({ status: "idle" })}
        installed
        readiness={readiness({ status: "ready" })}
        error={null}
        circle
        buttonRef={{ current: null }}
        onOpen={() => {}}
      />,
    );
    const button = screen.getByRole("button", { name: /Open Agent/ });
    expect(button.getAttribute("data-circle-tone")).toBe("idle");
    expect(button.getAttribute("data-circle-motion")).toBeNull();
    expect(button.querySelector("[data-circle-ring]")).toBeNull();
    expect(button.querySelector("[data-circle-pip]")).toBeNull();
    expect(button.querySelector("[data-circle-wave]")).toBeNull();

    view.rerender(
      <AgentCapsule
        snapshot={snapshot({ status: "starting", seq: 2 })}
        installed
        readiness={readiness({ status: "ready" })}
        error={null}
        circle
        buttonRef={{ current: null }}
        onOpen={() => {}}
      />,
    );
    expect(button.getAttribute("data-circle-tone")).toBe("working");
    expect(button.getAttribute("data-circle-motion")).toBe("wake");
    expect(button.querySelector("[data-circle-ring]")?.getAttribute("data-circle-ring")).toBe(
      "working",
    );
    expect(button.querySelector("[data-circle-wave]")?.getAttribute("data-circle-wave")).toBe(
      "wake",
    );
    expect(button.querySelector("[data-circle-pip]")?.getAttribute("data-circle-pip")).toBe(
      "working",
    );

    view.rerender(
      <AgentCapsule
        snapshot={snapshot({ status: "streaming", seq: 3 })}
        installed
        readiness={readiness({ status: "ready" })}
        error={null}
        circle
        buttonRef={{ current: null }}
        onOpen={() => {}}
      />,
    );
    expect(button.getAttribute("data-circle-phase")).toBe("working:streaming");
    expect(button.getAttribute("data-circle-motion")).toBe("shift");
    expect(button.querySelector("[data-circle-ring]")?.getAttribute("data-circle-ring")).toBe(
      "streaming",
    );
    const streamingWave = button.querySelector("[data-circle-wave]");
    expect(streamingWave).not.toBeNull();

    view.rerender(
      <AgentCapsule
        snapshot={snapshot({
          status: "streaming",
          seq: 4,
          messages: [{ id: "1:assistant", role: "assistant", text: "Partial" }],
        })}
        installed
        readiness={readiness({ status: "ready" })}
        error={null}
        circle
        buttonRef={{ current: null }}
        onOpen={() => {}}
      />,
    );
    expect(button.querySelector("[data-circle-wave]")).toBe(streamingWave);

    view.rerender(
      <AgentCapsule
        snapshot={snapshot({
          status: "completed",
          seq: 5,
          messages: [{ id: "1:assistant", role: "assistant", text: "Done" }],
        })}
        installed
        readiness={readiness({ status: "ready" })}
        error={null}
        circle
        buttonRef={{ current: null }}
        onOpen={() => {}}
      />,
    );
    expect(button.getAttribute("data-circle-tone")).toBe("completed");
    expect(button.getAttribute("data-circle-motion")).toBe("complete");
    expect(button.querySelector("[data-circle-ring]")?.getAttribute("data-circle-ring")).toBe(
      "completed",
    );
    expect(button.querySelector("[data-circle-pip]")?.getAttribute("data-circle-pip")).toBe(
      "completed",
    );

    view.rerender(
      <AgentCapsule
        snapshot={snapshot({ status: "failed", seq: 6, error: "Provider exited" })}
        installed
        readiness={readiness({ status: "ready" })}
        error={null}
        circle
        buttonRef={{ current: null }}
        onOpen={() => {}}
      />,
    );
    expect(button.getAttribute("data-circle-tone")).toBe("error");
    expect(button.getAttribute("data-circle-motion")).toBe("error");
    expect(button.querySelector("[data-circle-ring]")?.getAttribute("data-circle-ring")).toBe(
      "error",
    );
    expect(button.querySelector("[data-circle-pip]")?.getAttribute("data-circle-pip")).toBe(
      "error",
    );
  });

  test("ModelUsageSettings and EngineQuickPopover display 5h and weekly provider limits with reset countdowns", () => {
    const future5h = new Date(Date.now() + 2 * 3_600_000 + 15 * 60_000).toISOString();
    const futureWeekly = new Date(Date.now() + 4 * 86_400_000 + 3 * 3_600_000).toISOString();
    const limits = [
      {
        id: "codex:codex:primary",
        label: "5h limit",
        window: "5h",
        usedPercent: 85,
        remainingPercent: 15,
        resetsAt: future5h,
        group: null,
      },
      {
        id: "codex:codex:secondary",
        label: "Weekly limit",
        window: "weekly",
        usedPercent: 18,
        remainingPercent: 82,
        resetsAt: futureWeekly,
        group: null,
      },
    ];
    const view = render(
      <ModelUsageSettings
        provider="codex"
        readiness={readiness({ rateLimits: limits })}
        snapshot={snapshot({ provider: "codex", usage: null, rateLimits: [] })}
        model="gpt-5-codex"
        setModel={() => {}}
        thinkingEffort="high"
        setThinkingEffort={() => {}}
        busy={false}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText("Usage limits")).toBeTruthy();
    expect(screen.getByText("5h limit")).toBeTruthy();
    expect(screen.getByText("15% left")).toBeTruthy();
    expect(screen.getByText("85% used")).toBeTruthy();
    expect(screen.getByText("Weekly limit")).toBeTruthy();
    expect(screen.getByText("82% left")).toBeTruthy();
    expect(screen.getByText(/Resets in 2h/)).toBeTruthy();
    expect(screen.getByText(/Resets in 4d/)).toBeTruthy();
    expect(screen.getAllByRole("progressbar")).toHaveLength(2);

    view.rerender(
      <EngineQuickPopover
        provider="codex"
        model="gpt-5-codex"
        thinkingEffort="high"
        switcher={{
          providers: [{ id: "codex", displayName: "Codex", command: "codex", installed: true }],
          readiness: readiness({ rateLimits: limits }),
          rateLimits: limits,
          locked: false,
          onSelectProvider: () => {},
          onSelectModel: () => {},
          onSelectThinkingEffort: () => {},
          onOpenSettings: () => {},
        }}
        onOpenSettings={() => {}}
      />,
    );
    expect(screen.getByText("5h")).toBeTruthy();
    expect(screen.getByText("Weekly")).toBeTruthy();
    expect(screen.getByText("15% left")).toBeTruthy();
    expect(screen.getByText("82% left")).toBeTruthy();
  });

  test("resolveRateLimits merges live snapshot limits over readiness limits and formats reset durations", () => {
    const now = Date.UTC(2026, 9, 15, 10, 0, 0);
    const merged = resolveRateLimits(
      "codex",
      readiness({
        rateLimits: [
          {
            id: "codex:codex:primary",
            label: "5h limit",
            window: "5h",
            usedPercent: 10,
            remainingPercent: 90,
            resetsAt: null,
            group: null,
          },
          {
            id: "codex:codex:secondary",
            label: "Weekly limit",
            window: "weekly",
            usedPercent: 20,
            remainingPercent: 80,
            resetsAt: null,
            group: null,
          },
        ],
      }),
      snapshot({
        provider: "codex",
        rateLimits: [
          {
            id: "codex:codex:primary",
            label: "5h limit",
            window: "5h",
            usedPercent: 45,
            remainingPercent: 55,
            resetsAt: "2026-10-15T12:30:00Z",
            group: null,
          },
        ],
      }),
    );
    expect(merged.map((item) => [item.window, item.usedPercent])).toEqual([
      ["5h", 45],
      ["weekly", 20],
    ]);
    expect(formatResetTime("2026-10-15T12:30:00Z", now)).toBe("Resets in 2h 30m");
    expect(formatResetTime("2026-10-18T14:00:00Z", now)).toBe("Resets in 3d 4h");
    expect(formatResetTime("2026-10-15T09:00:00Z", now)).toBe("Resets soon");
  });

  test("EngineQuickSwitcher opens on Ctrl+M, filters large catalogs, pins favorites, and closes on Escape", () => {
    const picked: Array<string | null> = [];
    const toggledPins: string[] = [];
    const largeCatalog = [
      { id: "m-1", displayName: "Alpha 1", contextWindow: null, imageInput: true, thinkingEfforts: [], defaultThinkingEffort: null },
      { id: "m-2", displayName: "Beta 2", contextWindow: null, imageInput: true, thinkingEfforts: [], defaultThinkingEffort: null },
      { id: "m-3", displayName: "Gamma Flash", contextWindow: null, imageInput: true, thinkingEfforts: [], defaultThinkingEffort: null },
      { id: "m-4", displayName: "Delta Pro", contextWindow: null, imageInput: true, thinkingEfforts: [], defaultThinkingEffort: null },
      { id: "m-5", displayName: "Epsilon Mini", contextWindow: null, imageInput: true, thinkingEfforts: [], defaultThinkingEffort: null },
    ];
    render(
      <EngineQuickSwitcher
        provider="codex"
        model="m-1"
        thinkingEffort={null}
        switcher={{
          providers: [{ id: "codex", displayName: "Codex", command: "codex", installed: true }],
          readiness: readiness({ model: "m-1", models: largeCatalog, thinkingEfforts: [] }),
          pinnedModels: ["m-4"],
          locked: false,
          onSelectProvider: () => {},
          onSelectModel: (value) => picked.push(value),
          onTogglePinModel: (id) => toggledPins.push(id),
          onSelectThinkingEffort: () => {},
          onOpenSettings: () => {},
        }}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(document, { key: "m", ctrlKey: true });
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delta Pro" }));
    expect(picked).toEqual(["m-4"]);

    fireEvent.click(screen.getByRole("button", { name: "Pin Alpha 1" }));
    expect(toggledPins).toEqual(["m-1"]);

    const filter = screen.getByLabelText("Filter models") as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "gamma" } });
    fireEvent.click(screen.getByRole("button", { name: "Gamma Flash" }));
    expect(picked).toEqual(["m-4", "m-3"]);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
