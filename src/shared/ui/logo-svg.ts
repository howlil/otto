import {
  LOGO_BADGE_TONES,
  LOGO_EYE_TONES,
  type LogoConfig,
  type LogoEyeStyle,
  type LogoShape,
} from "./logo-model";

const MAX_CUSTOM_SVG_LENGTH = 48_000;

export function sanitizeCustomLogoSvg(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_CUSTOM_SVG_LENGTH) return null;
  if (!trimmed.includes("<svg") || !trimmed.includes("</svg>")) return null;
  const lower = trimmed.toLowerCase();
  if (
    lower.includes("<script") ||
    lower.includes("javascript:") ||
    lower.includes("<foreignobject") ||
    /\son[a-z]+\s*=/.test(lower)
  ) {
    return null;
  }
  const start = trimmed.indexOf("<svg");
  const end = trimmed.lastIndexOf("</svg>") + 6;
  if (start < 0 || end <= start) return null;
  return trimmed.slice(start, end);
}

export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function renderShapeBackground(shape: LogoShape, fillRgb: string, rimRgb: string): string {
  switch (shape) {
    case "circle":
      return `<circle cx="32" cy="32" r="28" fill="${fillRgb}" stroke="${rimRgb}" stroke-width="1.5"/>`;
    case "diamond":
      return `<rect x="11" y="11" width="42" height="42" rx="11" transform="rotate(45 32 32)" fill="${fillRgb}" stroke="${rimRgb}" stroke-width="1.5"/>`;
    case "hexagon":
      return `<polygon points="32,4 56,18 56,46 32,60 8,46 8,18" fill="${fillRgb}" stroke="${rimRgb}" stroke-width="1.5" stroke-linejoin="round"/>`;
    case "minimal":
      return "";
    default:
      return `<rect x="4" y="4" width="56" height="56" rx="18" fill="${fillRgb}" stroke="${rimRgb}" stroke-width="1.5"/>`;
  }
}

function renderEyesSvg(
  style: LogoEyeStyle,
  eyeRgb: string,
  scaleFactor: number,
  gapPx: number,
  filterAttr: string,
): string {
  const halfGap = (gapPx * 0.9) / 2;
  if (style === "visor") {
    const w = Math.round(30 * scaleFactor);
    const h = Math.round(10 * scaleFactor);
    const x = Math.round(32 - w / 2);
    const y = Math.round(32 - h / 2);
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.round(h / 2)}" fill="${eyeRgb}"${filterAttr}/>`;
  }
  if (style === "dot") {
    const r = Number((5.2 * scaleFactor).toFixed(1));
    const leftX = Number((32 - halfGap - r).toFixed(1));
    const rightX = Number((32 + halfGap + r).toFixed(1));
    return `<circle cx="${leftX}" cy="32" r="${r}" fill="${eyeRgb}"${filterAttr}/><circle cx="${rightX}" cy="32" r="${r}" fill="${eyeRgb}"${filterAttr}/>`;
  }
  if (style === "arc") {
    const w = Number((10 * scaleFactor).toFixed(1));
    const h = Number((8 * scaleFactor).toFixed(1));
    const leftX = Number((32 - halfGap - w / 2).toFixed(1));
    const rightX = Number((32 + halfGap + w / 2).toFixed(1));
    return `<path d="M ${Number((leftX - w / 2).toFixed(1))} 35 A ${Number((w / 2).toFixed(1))} ${h} 0 0 1 ${Number((leftX + w / 2).toFixed(1))} 35" stroke="${eyeRgb}" stroke-width="${Number((4.2 * scaleFactor).toFixed(1))}" stroke-linecap="round" fill="none"${filterAttr}/><path d="M ${Number((rightX - w / 2).toFixed(1))} 35 A ${Number((w / 2).toFixed(1))} ${h} 0 0 1 ${Number((rightX + w / 2).toFixed(1))} 35" stroke="${eyeRgb}" stroke-width="${Number((4.2 * scaleFactor).toFixed(1))}" stroke-linecap="round" fill="none"${filterAttr}/>`;
  }
  if (style === "spark") {
    const r = Number((7.2 * scaleFactor).toFixed(1));
    const inner = Number((r * 0.36).toFixed(1));
    const leftX = Number((32 - halfGap - r * 0.85).toFixed(1));
    const rightX = Number((32 + halfGap + r * 0.85).toFixed(1));
    const star = (cx: number) =>
      `<polygon points="${cx},${Number((32 - r).toFixed(1))} ${Number((cx + inner).toFixed(1))},${Number((32 - inner).toFixed(1))} ${Number((cx + r).toFixed(1))},32 ${Number((cx + inner).toFixed(1))},${Number((32 + inner).toFixed(1))} ${cx},${Number((32 + r).toFixed(1))} ${Number((cx - inner).toFixed(1))},${Number((32 + inner).toFixed(1))} ${Number((cx - r).toFixed(1))},32 ${Number((cx - inner).toFixed(1))},${Number((32 - inner).toFixed(1))}" fill="${eyeRgb}"${filterAttr}/>`;
    return `${star(leftX)}${star(rightX)}`;
  }
  const w = Number((8.5 * scaleFactor).toFixed(1));
  const h = Number((24 * scaleFactor).toFixed(1));
  const rx = Number((w / 2).toFixed(1));
  const y = Number((32 - h / 2).toFixed(1));
  const leftX = Number((32 - halfGap - w).toFixed(1));
  const rightX = Number((32 + halfGap).toFixed(1));
  return `<rect x="${leftX}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${eyeRgb}"${filterAttr}/><rect x="${rightX}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${eyeRgb}"${filterAttr}/>`;
}

export function buildOttoLogoSvg(config: LogoConfig): string {
  if (config.customSvg) {
    const clean = sanitizeCustomLogoSvg(config.customSvg);
    if (clean) return clean;
  }
  const badge =
    LOGO_BADGE_TONES.find((item) => item.id === config.badgeTone) ?? LOGO_BADGE_TONES[0];
  const eye = LOGO_EYE_TONES.find((item) => item.id === config.eyeTone) ?? LOGO_EYE_TONES[0];
  const scaleFactor = Math.max(0.75, Math.min(1.3, config.eyeScale / 100));
  const glowDefs = config.glow
    ? `<defs><filter id="otto-eye-glow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="0" stdDeviation="3.2" flood-color="${eye.rgb}" flood-opacity="0.65"/></filter></defs>`
    : "";
  const filterAttr = config.glow ? ` filter="url(#otto-eye-glow)"` : "";
  const shapeSvg = renderShapeBackground(config.shape, badge.rgb, badge.rimRgb);
  const eyesSvg = renderEyesSvg(config.eyeStyle, eye.rgb, scaleFactor, config.eyeGap, filterAttr);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" fill="none">${glowDefs}${shapeSvg}${eyesSvg}</svg>`;
}
