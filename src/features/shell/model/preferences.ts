export type Page = "agent" | "settings";
export type SettingsTab = "assistant" | "capture" | "voice" | "behavior" | "position" | "general";
export type SettingsFocus = "capture-shortcut";
export type Motion = "fluid" | "gentle" | "reduced";
export type Placement = "floating" | "attached";
export type CompactStyle = "capsule" | "circle";
export type BackgroundStyle = "solid" | "transparent";
export type PanelPosition = { x: number; y: number };

export type Preferences = {
  placement: Placement;
  compactStyle: CompactStyle;
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
  backgroundStyle: ["solid", "transparent"],
};

function validPreference(key: keyof Preferences, value: unknown): boolean {
  if (key === "position") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const position = value as Record<string, unknown>;
    return [position.x, position.y].every(
      (coordinate) =>
        typeof coordinate === "number" &&
        Number.isInteger(coordinate) &&
        coordinate >= -2147483648 &&
        coordinate <= 2147483647,
    );
  }
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
  if (prefs?.backgroundStyle !== "transparent") return 100;
  const raw = prefs.backgroundOpacity;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return defaults.backgroundOpacity;
  const [min, max] = BACKGROUND_OPACITY_RANGE;
  return Math.max(min, Math.min(max, Math.round(raw)));
}

export function readPreferences(): Preferences {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem("otto.preferences.v1") || "{}");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return { ...defaults };
    const persisted = saved as Record<string, unknown>;
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
