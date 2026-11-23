export const REGION_HANDLES = [
  "-left-[2px] -top-[2px]",
  "-right-[2px] -top-[2px]",
  "-bottom-[2px] -left-[2px]",
  "-bottom-[2px] -right-[2px]",
] as const;

export const SCREEN_CORNERS = [
  "left-[3px] top-[3px] border-l-[1.5px] border-t-[1.5px]",
  "right-[3px] top-[3px] border-r-[1.5px] border-t-[1.5px]",
  "bottom-[3px] left-[3px] border-b-[1.5px] border-l-[1.5px]",
  "bottom-[3px] right-[3px] border-b-[1.5px] border-r-[1.5px]",
] as const;

export const MINI_SCREEN_FRAME =
  "relative block h-12 w-[86px] shrink-0 overflow-hidden rounded-[5px] border bg-otto-ink-deep";

export function captureIllustrationTone(selected: boolean) {
  return {
    surface: selected
      ? "border-otto-hljs-function bg-otto-hljs-function/12"
      : "border-otto-slider-thumb/80 bg-otto-raised-soft",
    dashed: selected
      ? "border-otto-hljs-function bg-otto-hljs-function/15"
      : "border-otto-slider-thumb/80 bg-otto-slider-thumb/10",
    divider: selected ? "border-otto-hljs-function/40" : "border-otto-line-strong",
    seam: selected ? "border-otto-hljs-function/70" : "border-otto-line-hover",
    accent: selected ? "bg-otto-hljs-function" : "bg-otto-slider-thumb",
    dot: selected ? "bg-otto-hljs-function/80" : "bg-otto-slider-thumb/70",
    line: selected ? "bg-otto-text-bright/75" : "bg-otto-slider-thumb/55",
    corner: selected ? "border-otto-hljs-function" : "border-otto-slider-thumb/85",
    arrow: selected ? "text-otto-hljs-function" : "text-otto-text-tertiary",
    highlight: selected ? "bg-otto-hljs-function/25" : "bg-otto-slider-thumb/20",
    textBar: selected ? "bg-otto-text-bright" : "bg-otto-slider-thumb",
    fullOuter: selected
      ? "border-otto-hljs-function bg-otto-hljs-function/12"
      : "border-otto-slider-thumb/80",
  };
}
