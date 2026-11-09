import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

export type AgentStatus =
  | "idle"
  | "starting"
  | "streaming"
  | "stopping"
  | "completed"
  | "stopped"
  | "failed";

export type AgentProvider = "codex" | "pi" | "agy";
export type CaptureSource = "window" | "fullScreen";
export type CapturePhase =
  | "idle"
  | "preparing"
  | "capturing"
  | "submitting"
  | "analyzing"
  | "failed";

export type AgentCapture = {
  requestId: number;
  phase: CapturePhase;
  error: string | null;
};

export type AgentModelOption = {
  id: string;
  displayName: string;
  contextWindow: number | null;
  imageInput: boolean;
  thinkingEfforts: string[];
  defaultThinkingEffort: string | null;
};

export type AgentUsage = {
  contextTokens: number | null;
  sessionTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number | null;
  modelContextWindow: number | null;
};

export type AgentConversationSummary = {
  id: string;
  title: string;
  provider: AgentProvider;
  updatedAt: number;
  messageCount: number;
  interrupted: boolean;
};

export type ProviderReadiness = {
  status: "checking" | "ready" | "authRequired" | "missing" | "unsupported" | "unavailable";
  message: string;
  recovery: string;
  imageInput: boolean;
  imageTransport: boolean;
  toolFreeAdmission: boolean;
  model: string | null;
  models: AgentModelOption[];
  thinkingEffort: string | null;
  thinkingEfforts: string[];
};

export type AgentSnapshot = {
  runId: number;
  seq: number;
  status: AgentStatus;
  provider: AgentProvider;
  threadId: string | null;
  model: string | null;
  thinkingEffort: string | null;
  usage: AgentUsage | null;
  messages: Array<{ id: string; role: "user" | "assistant"; text: string }>;
  capture: AgentCapture;
  error: string | null;
};

export type TimerPhase = "focus" | "short" | "long";
export type TimerStatus = "ready" | "running" | "paused" | "completed";

export type TimerDurations = {
  focus: number;
  short: number;
  long: number;
};

export type TimerSnapshot = {
  revision: number;
  phase: TimerPhase;
  status: TimerStatus;
  remainingSeconds: number;
  durations: TimerDurations;
  completedFocusSessions: number;
};

export type NotchSurface =
  | "idle"
  | "home"
  | "homeSettings"
  | "agentCompact"
  | "musicCompact"
  | "musicPlayer"
  | "focusCompact"
  | "focus"
  | "focusSettings"
  | "musicLyrics"
  | "agentReady"
  | "agentThinking"
  | "agentFull"
  | "agentError"
  | "agentSettings"
  | "osEvent";

export type OsEventView =
  | { class: "volume"; id: number; percent: number; muted: boolean }
  | { class: "brightness"; id: number; percent: number }
  | { class: "wifi"; id: number; connected: boolean }
  | {
      class: "bluetooth";
      id: number;
      connected: boolean;
      kind: "audio" | "input" | "unknown";
      name: string | null;
    }
  | {
      class: "battery";
      id: number;
      plugged: boolean;
      charging: boolean;
      percent: number | null;
      low: boolean;
      critical: boolean;
    };

export type OsEventSubscription = {
  unsubscribe: () => Promise<void>;
};

export type MediaStatus = "loading" | "available" | "unavailable" | "unsupported";
export type MediaPlayback = "playing" | "paused" | "stopped" | "unknown";
export type MediaCommand = "toggle" | "previous" | "next" | "seek";

export type MediaControls = {
  toggle: boolean;
  previous: boolean;
  next: boolean;
  seek: boolean;
};

export type MediaSnapshot = {
  seq: number;
  status: MediaStatus;
  playback: MediaPlayback;
  title: string | null;
  artist: string | null;
  album?: string | null;
  sourceId?: string | null;
  observedAtMs?: number | null;
  playbackRate?: number | null;
  artworkDataUrl: string | null;
  positionMs: number | null;
  durationMs: number | null;
  minSeekMs: number | null;
  maxSeekMs: number | null;
  controls: MediaControls;
  message: string;
};

export type MediaSubscription = {
  unsubscribe: () => Promise<void>;
};

export const nativeAvailable = isTauri();

export async function getOverlayProtectionStatus(): Promise<boolean> {
  return invoke<boolean>("overlay_protection_status");
}

export async function setOverlayCaptureProtection(enabled: boolean): Promise<boolean> {
  return invoke<boolean>("overlay_set_capture_protection", { enabled });
}

export async function getAgentSnapshot(): Promise<AgentSnapshot> {
  return invoke<AgentSnapshot>("agent_snapshot");
}

export async function getFocusTimerSnapshot(): Promise<TimerSnapshot> {
  return invoke<TimerSnapshot>("focus_timer_snapshot");
}
export async function listAgentHistory(): Promise<AgentConversationSummary[]> {
  return invoke<AgentConversationSummary[]>("agent_history_list");
}
export async function openAgentHistory(id: string): Promise<AgentSnapshot> {
  return invoke<AgentSnapshot>("agent_history_open", { conversationId: id });
}
export async function renameAgentHistory(id: string, title: string): Promise<void> {
  await invoke("agent_history_rename", { conversationId: id, title });
}
export async function deleteAgentHistory(id: string): Promise<void> {
  await invoke("agent_history_delete", { conversationId: id });
}
export async function deleteAllAgentHistory(): Promise<void> {
  await invoke("agent_history_delete_all");
}
export async function codexInstalled(): Promise<boolean> {
  return invoke<boolean>("agent_codex_installed");
}
export async function getCodexReadiness(): Promise<ProviderReadiness> {
  return invoke<ProviderReadiness>("agent_codex_readiness");
}
export async function getAgentReadiness(
  provider: AgentProvider,
  requestId: number,
  model: string | null = null,
): Promise<ProviderReadiness> {
  return invoke<ProviderReadiness>("agent_provider_readiness", { provider, model, requestId });
}
export async function cancelAgentReadiness(requestId: number): Promise<void> {
  await invoke("agent_cancel_provider_readiness", { requestId });
}
export type AgentSubscription = {
  channel: Channel<AgentSnapshot>;
  unsubscribe: () => Promise<void>;
};

export type FocusTimerSubscription = {
  channel: Channel<TimerSnapshot>;
  unsubscribe: () => Promise<void>;
};

export async function subscribeAgent(
  onSnapshot: (snapshot: AgentSnapshot) => void,
): Promise<AgentSubscription> {
  const channel = new Channel<AgentSnapshot>();
  channel.onmessage = onSnapshot;
  const subscriptionId = await invoke<number>("agent_subscribe", { onEvent: channel });
  return {
    channel,
    unsubscribe: () => invoke("agent_unsubscribe", { subscriptionId }),
  };
}

export async function subscribeFocusTimer(
  onSnapshot: (snapshot: TimerSnapshot) => void,
): Promise<FocusTimerSubscription> {
  const channel = new Channel<TimerSnapshot>();
  channel.onmessage = onSnapshot;
  const subscriptionId = await invoke<number>("focus_timer_subscribe", { onEvent: channel });
  return {
    channel,
    unsubscribe: () => invoke("focus_timer_unsubscribe", { subscriptionId }),
  };
}

export async function startFocusTimer(): Promise<TimerSnapshot> {
  return invoke<TimerSnapshot>("focus_timer_start");
}

export async function pauseFocusTimer(): Promise<TimerSnapshot> {
  return invoke<TimerSnapshot>("focus_timer_pause");
}

export async function resetFocusTimer(): Promise<TimerSnapshot> {
  return invoke<TimerSnapshot>("focus_timer_reset");
}

export async function configureFocusTimer(durations: TimerDurations): Promise<TimerSnapshot> {
  return invoke<TimerSnapshot>("focus_timer_configure", { durations });
}

export async function selectFocusTimerPhase(
  phase: TimerPhase,
  discardActive: boolean,
): Promise<TimerSnapshot> {
  return invoke<TimerSnapshot>("focus_timer_select_phase", { phase, discardActive });
}

export async function startNextFocusTimer(): Promise<TimerSnapshot> {
  return invoke<TimerSnapshot>("focus_timer_start_next");
}
export async function subscribeOsEvents(
  onEvent: (event: OsEventView) => void,
): Promise<OsEventSubscription> {
  if (!nativeAvailable) return { unsubscribe: async () => {} };
  const channel = new Channel<OsEventView>();
  channel.onmessage = onEvent;
  const subscriptionId = await invoke<number>("os_events_subscribe", { onEvent: channel });
  return {
    unsubscribe: () => invoke("os_events_unsubscribe", { subscriptionId }),
  };
}

export async function setOsEventsEnabled(enabled: boolean): Promise<void> {
  if (nativeAvailable) await invoke("os_events_set_enabled", { enabled });
}

export type LyricsRecord = {
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
};

export type LyricsResult = { key: string; record: LyricsRecord | null };

export async function setOnlineLyrics(enabled: boolean): Promise<void> {
  return invoke("media_set_online_lyrics", { enabled });
}

export async function getMediaLyrics(refresh = false): Promise<LyricsResult> {
  return invoke("media_lyrics", { refresh });
}

export async function getMediaSnapshot(): Promise<MediaSnapshot> {
  return invoke<MediaSnapshot>("media_snapshot");
}

export async function subscribeMedia(
  onSnapshot: (snapshot: MediaSnapshot) => void,
): Promise<MediaSubscription> {
  if (!nativeAvailable) return { unsubscribe: async () => {} };
  const channel = new Channel<MediaSnapshot>();
  channel.onmessage = onSnapshot;
  const subscriptionId = await invoke<number>("media_subscribe", { onEvent: channel });
  return {
    unsubscribe: () => invoke("media_unsubscribe", { subscriptionId }),
  };
}

export async function refreshMedia(): Promise<MediaSnapshot> {
  return invoke<MediaSnapshot>("media_refresh");
}

export async function controlMedia(
  command: MediaCommand,
  positionMs?: number,
): Promise<MediaSnapshot> {
  return invoke<MediaSnapshot>("media_control", { command, positionMs });
}

export async function selectAgentProvider(provider: AgentProvider): Promise<void> {
  await invoke("agent_select_provider", { provider });
}

export async function selectAgentRuntimeOptions(
  model: string | null,
  thinkingEffort: string | null,
): Promise<void> {
  await invoke("agent_select_runtime_options", { model, thinkingEffort });
}

export type AcceptedAgentRun = { runId: number };

export async function askAgent(
  text: string,
  provider: AgentProvider,
  options: { model: string | null; thinkingEffort: string | null },
): Promise<AcceptedAgentRun> {
  return invoke<AcceptedAgentRun>("agent_ask", { text, provider, ...options });
}
export async function configureCaptureShortcut(shortcut: string): Promise<void> {
  await invoke("agent_configure_capture_shortcut", { shortcut });
}

export async function configureCaptureSource(source: CaptureSource): Promise<void> {
  await invoke("agent_configure_capture_source", { source });
}

export async function captureAgentNow(): Promise<void> {
  if (!nativeAvailable) throw new Error("Screen capture requires Otto on Windows.");
  await invoke("agent_capture_now");
}

export async function getCaptureTargetTitle(): Promise<string> {
  return invoke<string>("agent_capture_target_title");
}

export async function stopCodex(): Promise<void> {
  await invoke("agent_stop");
}
export async function newAgentChat(): Promise<void> {
  await invoke("agent_new_chat");
}

export async function onNotchFocusChanged(
  onFocus: (focused: boolean) => void,
): Promise<() => void> {
  if (!nativeAvailable) return () => {};
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().onFocusChanged(({ payload }) => onFocus(payload));
}

export type NotchShape = "capsule" | "card" | "attached";
export type NotchPlacement = "floating" | "attached";

export async function setNotchHitRegion(
  width: number,
  height: number,
  shape: NotchShape,
): Promise<void> {
  if (!nativeAvailable || width <= 0 || height <= 0) return;
  await invoke("notch_set_hit_region", {
    width: Math.round(width),
    height: Math.round(height),
    shape,
  });
}

export type AppliedSurface = {
  placement: NotchPlacement;
  width: number;
  height: number;
  outerWidth: number | null;
  outerHeight: number | null;
  geometryConfirmed: boolean;
};

export type NotchSurfaceRequest = {
  surface: NotchSurface;
  shape: NotchShape;
  topOffset?: number;
  contentHeight?: number;
  deferShrink?: boolean;
};

function normalizeSurface(
  value: {
    placement: string;
    width: number;
    height: number;
    outerWidth?: number | null;
    outerHeight?: number | null;
    geometryConfirmed?: boolean;
  },
  geometryConfirmedDefault: boolean,
): AppliedSurface {
  return {
    placement: value.placement === "attached" ? "attached" : "floating",
    width: value.width,
    height: value.height,
    outerWidth: value.outerWidth ?? null,
    outerHeight: value.outerHeight ?? null,
    geometryConfirmed: value.geometryConfirmed ?? geometryConfirmedDefault,
  };
}

export async function measureNotchSurface(
  request: Omit<NotchSurfaceRequest, "deferShrink">,
): Promise<AppliedSurface> {
  const { surface, shape, topOffset = 20, contentHeight } = request;
  if (!nativeAvailable) {
    return {
      placement: "floating",
      width: 0,
      height: 0,
      outerWidth: null,
      outerHeight: null,
      geometryConfirmed: false,
    };
  }
  const measured = await invoke<{
    placement: string;
    width: number;
    height: number;
    outerWidth?: number | null;
    outerHeight?: number | null;
    geometryConfirmed?: boolean;
  }>("notch_measure_surface", { surface, shape, topOffset, contentHeight });
  return normalizeSurface(measured, false);
}

export async function setNotchSurface(request: NotchSurfaceRequest): Promise<AppliedSurface> {
  const { surface, shape, topOffset = 20, contentHeight, deferShrink = false } = request;
  if (!nativeAvailable) {
    return {
      placement: "floating",
      width: 0,
      height: 0,
      outerWidth: null,
      outerHeight: null,
      geometryConfirmed: false,
    };
  }
  const applied = await invoke<{
    placement: string;
    width: number;
    height: number;
    outerWidth?: number | null;
    outerHeight?: number | null;
    geometryConfirmed?: boolean;
  }>("notch_set_surface", { surface, shape, topOffset, contentHeight, deferShrink });
  return normalizeSurface(applied, true);
}
