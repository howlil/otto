export type Page = "agent" | "settings";
export type SettingsTab = "assistant" | "capture" | "behavior" | "position" | "general";
export type SettingsFocus = "capture-shortcut";
export type Motion = "fluid" | "gentle" | "reduced";
export type Placement = "floating" | "attached";
export type CompactStyle = "capsule" | "circle";
export type BackgroundStyle = "solid" | "blur" | "liquid-glass";
export type HorizontalAnchor = "left" | "center" | "right";
export type VerticalAnchor = "top" | "bottom";
export type PanelPosition = {
  x: number;
  y: number;
  anchorX?: HorizontalAnchor;
  anchorY?: VerticalAnchor;
  height?: number;
};

export type Preferences = {
  placement: Placement;
  compactStyle: CompactStyle;
  dockWithOttoOs: boolean;
  hoverExpand: boolean;
  hoverDelay: number;
  leaveDelay: number;
  clickOutside: boolean;
  hideFromCapture: boolean;
  motion: Motion;
  topOffset: number;
  position: PanelPosition | null;
  backgroundStyle: BackgroundStyle;
  backgroundOpacity: number;
};

export const defaults: Preferences = {
  placement: "floating",
  compactStyle: "capsule",
  dockWithOttoOs: true,
  hoverExpand: true,
  hoverDelay: 150,
  leaveDelay: 340,
  clickOutside: true,
  hideFromCapture: true,
  motion: "fluid",
  topOffset: 20,
  position: null,
  backgroundStyle: "solid",
  backgroundOpacity: 78,
};

export const BACKGROUND_OPACITY_RANGE = [30, 95] as const;

const limits: Partial<Record<keyof Preferences, readonly [number, number]>> = {
  hoverDelay: [0, 400],
  leaveDelay: [0, 650],
  topOffset: [0, 64],
  backgroundOpacity: BACKGROUND_OPACITY_RANGE,
};
const choices: Partial<Record<keyof Preferences, readonly string[]>> = {
  motion: ["fluid", "gentle", "reduced"],
  placement: ["floating", "attached"],
  compactStyle: ["capsule", "circle"],
  backgroundStyle: ["solid", "blur", "liquid-glass"],
};

const horizontalAnchors = ["left", "center", "right"] as const;
const verticalAnchors = ["top", "bottom"] as const;

function validInt32(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= -2147483648 &&
    value <= 2147483647
  );
}

function validOptionalHeight(value: unknown): boolean {
  if (value === undefined) return true;
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 16384;
}

function validPosition(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const position = value as Record<string, unknown>;
  if (!validInt32(position.x) || !validInt32(position.y)) return false;
  const validX =
    position.anchorX === undefined ||
    horizontalAnchors.includes(position.anchorX as HorizontalAnchor);
  const validY =
    position.anchorY === undefined || verticalAnchors.includes(position.anchorY as VerticalAnchor);
  return validX && validY && validOptionalHeight(position.height);
}

function validPreference(key: keyof Preferences, value: unknown): boolean {
  if (key === "position") return validPosition(value);
  if (typeof value !== typeof defaults[key]) return false;
  if (typeof value === "number") {
    const range = limits[key];
    return (
      Number.isFinite(value) &&
      ((key !== "topOffset" && key !== "backgroundOpacity") || Number.isInteger(value)) &&
      Boolean(range && value >= range[0] && value <= range[1])
    );
  }
  if (typeof value === "string") return choices[key]?.includes(value) ?? false;
  return typeof value === "boolean";
}

export function surfaceOpacityPercent(
  prefs?: Partial<Pick<Preferences, "backgroundStyle" | "backgroundOpacity">> | null,
): number {
  const style = prefs?.backgroundStyle;
  if (!style || style === "solid") return 100;
  const raw = prefs.backgroundOpacity;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return defaults.backgroundOpacity;
  const [min, max] = BACKGROUND_OPACITY_RANGE;
  return Math.max(min, Math.min(max, Math.round(raw)));
}

export function readPreferences(): Preferences {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem("otto.preferences.v1") || "{}");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return { ...defaults };
    const persisted = { ...(saved as Record<string, unknown>) };
    if (persisted.backgroundStyle === "transparent") {
      persisted.backgroundStyle = "blur";
    }
    const result = { ...defaults };
    for (const key of Object.keys(defaults) as Array<keyof Preferences>) {
      if (validPreference(key, persisted[key])) {
        (result as unknown as Record<string, unknown>)[key] = persisted[key];
      }
    }
    return result;
  } catch {
    return { ...defaults };
  }
}

export function mergePreferences(current: Preferences, patch: Partial<Preferences>): Preferences {
  return {
    ...current,
    ...patch,
    hideFromCapture: current.hideFromCapture,
    placement: current.placement,
  };
}

export function confirmedPlacementPreference(
  current: Preferences,
  observed: Placement | null,
): Preferences {
  return observed === null || observed === current.placement
    ? current
    : { ...current, placement: observed };
}

export function confirmedCapturePreference(
  current: Preferences,
  confirmed: boolean | null,
): Preferences {
  return confirmed === null ? current : { ...current, hideFromCapture: confirmed };
}
