export type Page = "home" | "agent" | "global-settings" | "agent-settings";
export type SettingsTab = "appearance" | "interaction" | "system" | "placement";
export type Expression = "calm" | "curious" | "sleepy" | "happy";
export type Motion = "fluid" | "gentle" | "reduced";
export type Placement = "floating" | "attached";

export type Preferences = {
  expression: Expression;
  reactive: "quiet" | "alive";
  placement: Placement;
  hoverExpand: boolean;
  hoverDelay: number;
  leaveDelay: number;
  clickOutside: boolean;
  hideFromCapture: boolean;
  osEventsEnabled: boolean;
  motion: Motion;
  tilt: number;
  gradient: number;
  topOffset: number;
};

export const defaults: Preferences = {
  expression: "calm",
  reactive: "quiet",
  placement: "floating",
  hoverExpand: true,
  hoverDelay: 150,
  leaveDelay: 340,
  clickOutside: true,
  hideFromCapture: true,
  osEventsEnabled: true,
  motion: "fluid",
  tilt: 43,
  gradient: 80,
  topOffset: 20,
};

const limits: Partial<Record<keyof Preferences, readonly [number, number]>> = {
  hoverDelay: [0, 400],
  leaveDelay: [0, 650],
  tilt: [0, 65],
  gradient: [0, 100],
  topOffset: [0, 64],
};
const choices: Partial<Record<keyof Preferences, readonly string[]>> = {
  expression: ["calm", "curious", "sleepy", "happy"],
  reactive: ["quiet", "alive"],
  motion: ["fluid", "gentle", "reduced"],

  placement: ["floating", "attached"],
};

function validPreference(key: keyof Preferences, value: unknown): boolean {
  if (typeof value !== typeof defaults[key]) return false;
  if (typeof value === "number") {
    const range = limits[key];
    return (
      Number.isFinite(value) &&
      (key !== "topOffset" || Number.isInteger(value)) &&
      Boolean(range && value >= range[0] && value <= range[1])
    );
  }
  if (typeof value === "string") return choices[key]?.includes(value) ?? false;
  return typeof value === "boolean";
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
