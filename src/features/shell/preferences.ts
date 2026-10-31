// Shell preferences: durable tuning values that every module reads.
// Owner: ui-local. This module owns the shape, the defaults, and the read
// path; the App shell owns the live value and the persistence effect.
export type Page = "home" | "agent" | "global-settings" | "agent-settings";
export type SettingsTab = "general" | "interaction" | "motion" | "placement";
export type Expression = "calm" | "curious" | "sleepy" | "happy";
export type Motion = "fluid" | "gentle" | "reduced";

export type Preferences = {
  expression: Expression;
  reactive: "quiet" | "alive";
  hoverExpand: boolean;
  hoverDelay: number;
  leaveDelay: number;
  clickOutside: boolean;
  motion: Motion;
  parallax: boolean;
  tilt: number;
  gradient: number;
  topOffset: number;
};

export const defaults: Preferences = {
  expression: "calm",
  reactive: "quiet",
  hoverExpand: true,
  hoverDelay: 150,
  leaveDelay: 340,
  clickOutside: true,
  motion: "fluid",
  parallax: true,
  tilt: 43,
  gradient: 80,
  topOffset: 20,
};

export function readPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem("otto.preferences.v1") || "{}");
    if (!saved || typeof saved !== "object") return defaults;
    const result = { ...defaults };
    for (const key of Object.keys(defaults) as Array<keyof Preferences>) {
      if (typeof saved[key] === typeof defaults[key]) {
        // The native boundary still validates top offset and screen geometry.
        (result as unknown as Record<string, unknown>)[key] = saved[key];
      }
    }
    return result;
  } catch {
    return defaults;
  }
}
