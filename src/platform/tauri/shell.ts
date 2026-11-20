import { invoke } from "@tauri-apps/api/core";
import { nativeAvailable } from "./runtime";

export type NotchSurface =
  | "agentCompact"
  | "settings"
  | "agentReady"
  | "agentThinking"
  | "agentFull"
  | "agentError";

export type NotchShape = "capsule" | "card" | "attached";
export type NotchPlacement = "floating" | "attached";
export type NotchPosition = { x: number; y: number };

export type DisplayGeometry = {
  source: "physical-notch" | "notchless" | "approximate";
  notchWidth: number;
  notchHeight: number;
  safeTop: number;
  menuTop: number;
};

export type NotchLayouts = Record<NotchSurface, readonly [number, number]>;

export type NotchHost = {
  display?: DisplayGeometry;
  contentTop?: number;
  revision: number;
  placement: NotchPlacement;
  width: number;
  height: number;
  scale: number;
  layouts: NotchLayouts;
  ottoOs?: boolean;
};

export type NotchRegionPx = {
  hostRevision: number;
  sequence: number;
  body: { x: number; y: number; width: number; height: number };
  radius: { top: number; bottom: number };
  shoulder: number;
  morph?: boolean;
};

const notchClientId = crypto.randomUUID();

async function invokeNotch<T>(command: string, payload: Record<string, unknown>): Promise<T> {
  const start = performance.now();
  try {
    return await invoke<T>(command, payload);
  } finally {
    performance.clearMeasures(command);
    performance.measure(command, { start, end: performance.now() });
  }
}

export async function onNotchFocusChanged(
  onFocus: (focused: boolean) => void,
): Promise<() => void> {
  if (!nativeAvailable) return () => {};
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().onFocusChanged(({ payload }) => onFocus(payload));
}

export async function configureNotchHost(
  placement: NotchPlacement,
  topOffset: number,
  capacity: { width: number; height: number },
  position: NotchPosition | null,
  attempt = 0,
): Promise<NotchHost> {
  return invokeNotch("notch_configure_host", {
    request: { placement, topOffset, position, ...capacity, clientId: notchClientId, attempt },
  });
}

export async function startNotchDragging(): Promise<void> {
  if (!nativeAvailable) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().startDragging();
}

export async function setNotchRegion(region: NotchRegionPx): Promise<boolean> {
  return invokeNotch("notch_set_region", { region });
}

export async function onNotchHostChanged(
  changed: () => void,
  onMoved?: (position: NotchPosition) => void,
): Promise<() => void> {
  if (!nativeAvailable) return () => {};
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const { listen } = await import("@tauri-apps/api/event");
  const window = getCurrentWindow();
  let lastPosition = "";
  const listeners = await Promise.allSettled([
    listen("otto-display-changed", changed),
    window.onScaleChanged?.(changed),
    window.onMoved?.(({ payload }) => {
      const position = `${payload.x},${payload.y}`;
      if (position === lastPosition) return;
      lastPosition = position;
      onMoved?.(payload);
    }),
  ]);
  const stop = () => {
    for (const listener of listeners) {
      if (listener.status === "fulfilled") listener.value?.();
    }
  };
  const failure = listeners.find((listener) => listener.status === "rejected");
  if (failure?.status === "rejected") {
    stop();
    throw failure.reason;
  }
  return stop;
}

export async function notchPointerPosition(): Promise<{ x: number; y: number } | null> {
  if (!nativeAvailable) return null;
  const { cursorPosition, getCurrentWindow } = await import("@tauri-apps/api/window");
  const window = getCurrentWindow();
  const [cursor, origin, scale] = await Promise.all([
    cursorPosition(),
    window.innerPosition(),
    window.scaleFactor(),
  ]);
  return { x: (cursor.x - origin.x) / scale, y: (cursor.y - origin.y) / scale };
}

export async function ottoOsActive(): Promise<boolean> {
  if (!nativeAvailable) return false;
  return invoke<boolean>("otto_os_active");
}

export async function onOttoOsChanged(changed: (active: boolean) => void): Promise<() => void> {
  if (!nativeAvailable) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<boolean>("otto-os-changed", ({ payload }) => changed(payload));
}

export async function onOttoOsDock(dock: () => void): Promise<() => void> {
  if (!nativeAvailable) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen("otto-os-dock", dock);
}
