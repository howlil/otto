import { useEffect, useState, type CSSProperties } from "react";
import { LOGO_EYE_TONES, type LogoEyeStyle, type LogoEyeTone } from "./logo-model";

const BLINK_INTERVAL_MS = 6500;
const BLINK_DURATION_MS = 220;

export type EyeExpression = "idle" | "thinking" | "working" | "completed" | "attention" | "error";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function useIdleBlink(active: boolean): boolean {
  const [blinking, setBlinking] = useState(false);

  useEffect(() => {
    if (!active || prefersReducedMotion()) {
      setBlinking(false);
      return;
    }
    let waitTimer: number | null = null;
    let blinkTimer: number | null = null;
    const clearTimers = () => {
      if (waitTimer !== null) window.clearTimeout(waitTimer);
      if (blinkTimer !== null) window.clearTimeout(blinkTimer);
      waitTimer = null;
      blinkTimer = null;
    };
    const schedule = () => {
      clearTimers();
      if (typeof document !== "undefined" && document.hidden) return;
      waitTimer = window.setTimeout(() => {
        waitTimer = null;
        if (typeof document !== "undefined" && document.hidden) return;
        setBlinking(true);
        blinkTimer = window.setTimeout(() => {
          blinkTimer = null;
          setBlinking(false);
          schedule();
        }, BLINK_DURATION_MS);
      }, BLINK_INTERVAL_MS);
    };
    const onVisibility = () => {
      if (document.hidden) {
        clearTimers();
        setBlinking(false);
      } else {
        schedule();
      }
    };
    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimers();
      document.removeEventListener("visibilitychange", onVisibility);
      setBlinking(false);
    };
  }, [active]);

  return blinking;
}

const MINI_SHAPES: Record<EyeExpression, readonly [string, string]> = {
  idle: ["h-3 w-[5px] rounded-[7px]", "h-3 w-[5px] rounded-[7px]"],
  thinking: ["h-[11px] w-[5px] rounded-[7px]", "h-[11px] w-[5px] rounded-[7px]"],
  working: ["h-[11px] w-[5px] rounded-[7px]", "h-[11px] w-[5px] rounded-[7px]"],
  completed: [
    "h-[7px] w-[7px] rounded-t-full rounded-b-[3px]",
    "h-[7px] w-[7px] rounded-t-full rounded-b-[3px]",
  ],
  attention: ["h-[10px] w-[5px] rounded-[7px]", "h-[13px] w-[5px] -translate-y-px rounded-[7px]"],
  error: ["h-[6px] w-[7px] rounded-[7px]", "h-[6px] w-[7px] rounded-[7px]"],
};

const CUSTOM_MINI: Record<Exclude<LogoEyeStyle, "pill" | "visor">, string> = {
  dot: "h-[6.5px] w-[6.5px] rounded-full",
  arc: "h-[6px] w-[7.5px] rounded-t-full rounded-b-[2px]",
  spark: "h-[8.5px] w-[8.5px]",
};

const CUSTOM_FULL: Record<Exclude<LogoEyeStyle, "pill" | "visor">, string> = {
  dot: "h-2 w-2 rounded-full",
  arc: "h-[7px] w-[9px] rounded-t-full rounded-b-[2.5px]",
  spark: "h-[10.5px] w-[10.5px]",
};

const SPARK_CLIP_STYLE: CSSProperties = {
  clipPath: "polygon(50% 0%, 66% 34%, 100% 50%, 66% 66%, 50% 100%, 34% 66%, 0% 50%, 34% 34%)",
};

function resolveShapes(eyeStyle: LogoEyeStyle, mini: boolean, expression: EyeExpression) {
  if (eyeStyle !== "pill" && eyeStyle !== "visor") {
    const cls = mini ? CUSTOM_MINI[eyeStyle] : CUSTOM_FULL[eyeStyle];
    return [cls, cls] as const;
  }
  if (mini) return MINI_SHAPES[expression];
  return ["h-[13px] w-1.5 rounded-[7px]", "h-[13px] w-1.5 rounded-[7px]"] as const;
}

function expressionMotionClass(
  expression: EyeExpression,
  expressive: boolean,
  blinking: boolean,
): string {
  if (!expressive) return "";
  if (expression === "idle") return blinking ? "otto-eyes-blinking" : "";
  if (expression === "thinking" || expression === "working") return "otto-eyes-working";
  if (expression === "completed") return "otto-eyes-completed";
  return "";
}

function resolveEyeColor(eyeTone: LogoEyeTone | undefined, mini: boolean, compact: boolean) {
  const entry = eyeTone ? LOGO_EYE_TONES.find((item) => item.id === eyeTone) : undefined;
  if (entry && entry.id !== "chalk") return { bgClass: entry.bgClass, rgb: entry.rgb };
  const bgClass = mini ? "bg-otto-agent-eye" : compact ? "bg-otto-idle-eye" : "bg-otto-text";
  return { bgClass, rgb: "rgb(244, 244, 244)" };
}

function resolveWrapStyle(
  eyeScale: number,
  eyeGap: number | undefined,
  mini: boolean,
  glow: boolean,
  eyeRgb: string,
): CSSProperties | undefined {
  const clampedScale = Math.max(75, Math.min(125, eyeScale));
  const transform = clampedScale !== 100 ? `scale(${(clampedScale / 100).toFixed(2)})` : undefined;
  const rawGap = eyeGap !== undefined ? Math.max(4, Math.min(12, eyeGap)) : undefined;
  const scaledGap = rawGap !== undefined ? (mini ? Math.round(rawGap * 0.75) : rawGap) : undefined;
  const defaultGap = mini ? 6 : 8;
  const gap = scaledGap !== undefined && scaledGap !== defaultGap ? `${scaledGap}px` : undefined;
  const filter = glow ? `drop-shadow(0 0 3.5px ${eyeRgb})` : undefined;
  if (!transform && !gap && !filter) return undefined;
  return {
    ...(transform ? { transform } : {}),
    ...(gap ? { gap } : {}),
    ...(filter ? { filter } : {}),
  };
}

export interface EyesProps {
  mini?: boolean;
  compact?: boolean;
  expression?: EyeExpression;
  expressive?: boolean;
  eyeStyle?: LogoEyeStyle;
  eyeTone?: LogoEyeTone;
  eyeScale?: number;
  eyeGap?: number;
  glow?: boolean;
}

export function Eyes(props: EyesProps) {
  const { mini = false, compact = false, expression = "idle", expressive = false } = props;
  const { eyeStyle = "pill", eyeTone, eyeScale = 100, eyeGap, glow = false } = props;
  const blinking = useIdleBlink(expressive && expression === "idle");
  const baseShapes = resolveShapes(eyeStyle, mini, expression);
  const { bgClass: eyeColor, rgb: eyeRgb } = resolveEyeColor(eyeTone, mini, compact);
  const hover =
    compact && expression === "idle" && eyeStyle === "pill"
      ? "group-hover:h-3 group-hover:w-[11px] group-hover:-translate-y-px"
      : "";
  const motion = expressionMotionClass(expression, expressive, blinking);
  const wrapStyle = resolveWrapStyle(eyeScale, eyeGap, mini, glow, eyeRgb);
  const itemStyle = eyeStyle === "spark" ? SPARK_CLIP_STYLE : undefined;
  const widthClass = mini ? "w-[23px] gap-1.5" : "w-7 gap-2";
  const baseEye = `otto-eye block flex-none ${eyeColor} transition-[height,width,transform,border-radius] duration-[190ms] ease-otto`;

  return (
    <span
      data-eye-expression={expression}
      data-eye-style={eyeStyle !== "pill" ? eyeStyle : undefined}
      style={wrapStyle}
      className={`inline-flex h-[23px] flex-none items-center justify-center ${widthClass} ${motion}`}
      aria-hidden="true"
    >
      {eyeStyle === "visor" ? (
        <i className={`${baseEye} rounded-full ${mini ? "h-[5px] w-[15px]" : "h-1.5 w-[19px]"}`} />
      ) : (
        (["left", "right"] as const).map((side, i) => (
          <i key={side} style={itemStyle} className={`${baseEye} ${baseShapes[i]} ${hover}`} />
        ))
      )}
    </span>
  );
}
