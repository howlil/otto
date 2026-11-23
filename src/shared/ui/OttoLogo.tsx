import type { CSSProperties } from "react";
import { Eyes, type EyeExpression } from "./Eyes";
import {
  LOGO_BADGE_TONES,
  defaultLogoConfig,
  useLogoConfig,
  type LogoConfig,
  type LogoShape,
} from "./logo-model";
import { sanitizeCustomLogoSvg, svgToDataUrl } from "./logo-svg";

function shapeBackdropClass(
  shape: LogoShape,
  compact: boolean,
  previewMinimalFrame: boolean,
): string {
  switch (shape) {
    case "circle":
      return "inset-0 rounded-full ring-1 ring-inset ring-white/10";
    case "diamond":
      return compact
        ? "inset-[3px] rotate-45 rounded-[5.5px] ring-1 ring-inset ring-white/10"
        : "inset-[4px] rotate-45 rounded-[7px] ring-1 ring-inset ring-white/10";
    case "hexagon":
      return "inset-[0.5px]";
    case "minimal":
      return previewMinimalFrame
        ? "inset-0.5 rounded-[8px] border border-dashed border-otto-line-strong"
        : "inset-0 rounded-[8.5px]";
    default:
      return compact
        ? "inset-0 rounded-[8.5px] ring-1 ring-inset ring-white/10"
        : "inset-0 rounded-otto-panel ring-1 ring-inset ring-white/10";
  }
}

function shapeStyle(shape: LogoShape): CSSProperties | undefined {
  if (shape === "hexagon") {
    return {
      clipPath: "polygon(50% 3%, 93% 26%, 93% 74%, 50% 97%, 7% 74%, 7% 26%)",
    };
  }
  return undefined;
}

export function OttoLogo({
  compact = false,
  expression = "idle",
  expressive = false,
  config: overrideConfig,
  previewMinimalFrame = false,
}: {
  compact?: boolean;
  expression?: EyeExpression;
  expressive?: boolean;
  config?: LogoConfig;
  previewMinimalFrame?: boolean;
} = {}) {
  const [savedConfig] = useLogoConfig(!overrideConfig);
  const config = overrideConfig ?? savedConfig ?? defaultLogoConfig;
  const badge =
    LOGO_BADGE_TONES.find((item) => item.id === config.badgeTone) ?? LOGO_BADGE_TONES[0];
  const bgClass =
    config.shape === "minimal" ? "bg-transparent" : `${badge.bgClass} group-hover:brightness-110`;
  const sizeClass = compact ? "h-7 w-7" : "h-[34px] w-[34px]";
  const backdropClass = shapeBackdropClass(config.shape, compact, previewMinimalFrame);
  const customCleanSvg = config.customSvg ? sanitizeCustomLogoSvg(config.customSvg) : null;

  return (
    <span
      className={`${sizeClass} relative inline-grid flex-none shrink-0 place-items-center text-otto-control-text`}
      data-logo-shape={config.shape}
      data-logo-tone={config.badgeTone}
    >
      <span
        aria-hidden="true"
        data-otto-logo="true"
        style={shapeStyle(config.shape)}
        className={`pointer-events-none absolute ${backdropClass} ${bgClass} transition-[background,filter,transform] duration-[160ms] ease-otto`}
      />
      <span className="relative z-10 inline-flex items-center justify-center">
        {customCleanSvg ? (
          <img
            src={svgToDataUrl(customCleanSvg)}
            alt=""
            className={`${compact ? "h-4 w-4" : "h-5 w-5"} object-contain`}
          />
        ) : (
          <Eyes
            mini={compact}
            compact={compact}
            expression={expression}
            expressive={expressive}
            eyeStyle={config.eyeStyle}
            eyeTone={config.eyeTone}
            eyeScale={config.eyeScale}
            eyeGap={config.eyeGap}
            glow={config.glow}
          />
        )}
      </span>
    </span>
  );
}
