import { nativeAvailable } from "../tauri";

export {
  configureNotchHost,
  nativeAvailable,
  onNotchFocusChanged,
  setNotchRegion,
} from "../tauri";

export type { NotchHost, NotchRegionPx, NotchPlacement, NotchShape, NotchSurface } from "../tauri";

export async function onNotchHostChanged(changed: () => void): Promise<() => void> {
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
      changed();
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
