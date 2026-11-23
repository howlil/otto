import { useEffect, useState } from "react";

export type LogoShape = "squircle" | "circle" | "diamond" | "hexagon" | "minimal";
export type LogoEyeStyle = "pill" | "dot" | "arc" | "visor" | "spark";
export type LogoBadgeTone =
  | "graphite"
  | "obsidian"
  | "midnight"
  | "emerald"
  | "violet"
  | "crimson"
  | "amber"
  | "frost";
export type LogoEyeTone = "chalk" | "sky" | "mint" | "amber" | "lilac" | "rose" | "obsidian";

export type LogoConfig = {
  shape: LogoShape;
  eyeStyle: LogoEyeStyle;
  badgeTone: LogoBadgeTone;
  eyeTone: LogoEyeTone;
  eyeScale: number;
  eyeGap: number;
  glow: boolean;
  customSvg: string | null;
};

export const LOGO_STORAGE_KEY = "otto.logo.v1";
const LOGO_EVENT = "otto:logo-change";

export const LOGO_SHAPES: ReadonlyArray<{ id: LogoShape; label: string }> = [
  { id: "squircle", label: "Notch" },
  { id: "circle", label: "Circle" },
  { id: "diamond", label: "Diamond" },
  { id: "hexagon", label: "Hex" },
  { id: "minimal", label: "Minimal" },
];

export const LOGO_EYE_STYLES: ReadonlyArray<{ id: LogoEyeStyle; label: string }> = [
  { id: "pill", label: "Pill" },
  { id: "dot", label: "Dot" },
  { id: "arc", label: "Arc" },
  { id: "visor", label: "Visor" },
  { id: "spark", label: "Spark" },
];

type BadgeToneSpec = {
  id: LogoBadgeTone;
  label: string;
  bgClass: string;
  rgb: string;
  rimRgb: string;
};

function tone(
  id: LogoBadgeTone,
  label: string,
  bgClass: string,
  rgb: string,
  rimRgb: string,
): BadgeToneSpec {
  return { id, label, bgClass, rgb, rimRgb };
}

export const LOGO_BADGE_TONES: ReadonlyArray<BadgeToneSpec> = [
  tone("graphite", "Graphite", "bg-otto-raised-soft", "rgb(35, 38, 45)", "rgb(56, 56, 59)"),
  tone("obsidian", "Obsidian", "bg-otto-surface", "rgb(16, 17, 20)", "rgb(43, 46, 53)"),
  tone("midnight", "Midnight", "bg-otto-logo-midnight", "rgb(23, 33, 51)", "rgb(56, 78, 112)"),
  tone("emerald", "Emerald", "bg-otto-logo-emerald", "rgb(20, 44, 37)", "rgb(52, 98, 82)"),
  tone("violet", "Violet", "bg-otto-logo-violet", "rgb(38, 27, 56)", "rgb(88, 64, 122)"),
  tone("crimson", "Crimson", "bg-otto-logo-crimson", "rgb(52, 24, 33)", "rgb(112, 56, 72)"),
  tone("amber", "Amber", "bg-otto-logo-amber", "rgb(48, 35, 20)", "rgb(110, 82, 46)"),
  tone("frost", "Frost", "bg-otto-text-bright", "rgb(231, 231, 233)", "rgb(255, 255, 255)"),
];

export const LOGO_EYE_TONES: ReadonlyArray<{
  id: LogoEyeTone;
  label: string;
  bgClass: string;
  rgb: string;
}> = [
  { id: "chalk", label: "Chalk", bgClass: "bg-otto-agent-eye", rgb: "rgb(244, 244, 244)" },
  { id: "sky", label: "Sky", bgClass: "bg-otto-hljs-function", rgb: "rgb(159, 188, 216)" },
  { id: "mint", label: "Mint", bgClass: "bg-otto-ok", rgb: "rgb(156, 184, 168)" },
  { id: "amber", label: "Gold", bgClass: "bg-otto-warn", rgb: "rgb(224, 185, 120)" },
  { id: "lilac", label: "Lilac", bgClass: "bg-otto-hljs-keyword", rgb: "rgb(201, 166, 222)" },
  { id: "rose", label: "Rose", bgClass: "bg-otto-danger", rgb: "rgb(216, 145, 151)" },
  { id: "obsidian", label: "Ink", bgClass: "bg-otto-surface", rgb: "rgb(16, 17, 20)" },
];

export const defaultLogoConfig: LogoConfig = {
  shape: "squircle",
  eyeStyle: "pill",
  badgeTone: "graphite",
  eyeTone: "chalk",
  eyeScale: 100,
  eyeGap: 8,
  glow: false,
  customSvg: null,
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function pickId<T extends string>(list: ReadonlyArray<{ id: T }>, value: unknown, fallback: T): T {
  return list.some((item) => item.id === value) ? (value as T) : fallback;
}

export function normalizeLogoConfig(raw: unknown): LogoConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...defaultLogoConfig };
  const record = raw as Partial<Record<keyof LogoConfig, unknown>>;
  const customSvg =
    typeof record.customSvg === "string" && record.customSvg.trim().length > 0
      ? record.customSvg.trim()
      : null;
  return {
    shape: pickId(LOGO_SHAPES, record.shape, defaultLogoConfig.shape),
    eyeStyle: pickId(LOGO_EYE_STYLES, record.eyeStyle, defaultLogoConfig.eyeStyle),
    badgeTone: pickId(LOGO_BADGE_TONES, record.badgeTone, defaultLogoConfig.badgeTone),
    eyeTone: pickId(LOGO_EYE_TONES, record.eyeTone, defaultLogoConfig.eyeTone),
    eyeScale: clampInt(record.eyeScale, 75, 130, defaultLogoConfig.eyeScale),
    eyeGap: clampInt(record.eyeGap, 4, 14, defaultLogoConfig.eyeGap),
    glow: typeof record.glow === "boolean" ? record.glow : defaultLogoConfig.glow,
    customSvg,
  };
}

export function readLogoConfig(): LogoConfig {
  if (typeof localStorage === "undefined") return { ...defaultLogoConfig };
  try {
    const raw = localStorage.getItem(LOGO_STORAGE_KEY);
    return raw ? normalizeLogoConfig(JSON.parse(raw)) : { ...defaultLogoConfig };
  } catch {
    return { ...defaultLogoConfig };
  }
}

export function writeLogoConfig(next: LogoConfig): LogoConfig {
  const normalized = normalizeLogoConfig(next);
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(LOGO_STORAGE_KEY, JSON.stringify(normalized));
    } catch {}
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(LOGO_EVENT, { detail: normalized }));
  }
  return normalized;
}

export function useLogoConfig(
  subscribe = true,
): [LogoConfig, (patch: Partial<LogoConfig>) => void, () => void] {
  const [config, setConfig] = useState<LogoConfig>(() =>
    subscribe ? readLogoConfig() : defaultLogoConfig,
  );
  useEffect(() => {
    if (!subscribe) return;
    const onUpdate = () => setConfig(readLogoConfig());
    window.addEventListener(LOGO_EVENT, onUpdate);
    window.addEventListener("storage", onUpdate);
    return () => {
      window.removeEventListener(LOGO_EVENT, onUpdate);
      window.removeEventListener("storage", onUpdate);
    };
  }, [subscribe]);
  const update = (patch: Partial<LogoConfig>) => {
    const next = writeLogoConfig({ ...readLogoConfig(), ...patch });
    setConfig(next);
  };
  const reset = () => {
    const next = writeLogoConfig(defaultLogoConfig);
    setConfig(next);
  };
  return [config, update, reset];
}
