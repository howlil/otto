export type EyeExpression =
  | "idle"
  | "thinking"
  | "working"
  | "listening"
  | "speaking"
  | "completed"
  | "attention"
  | "error";

function miniEyeShapes(expression: EyeExpression): readonly [string, string] {
  switch (expression) {
    case "listening":
      return ["h-[13px] w-[6px]", "h-[13px] w-[6px]"];
    case "speaking":
      return ["h-[11px] w-[6px]", "h-[11px] w-[6px]"];
    case "completed":
      return [
        "h-[7px] w-[7px] rounded-t-full rounded-b-[3px]",
        "h-[7px] w-[7px] rounded-t-full rounded-b-[3px]",
      ];
    case "attention":
      return ["h-[10px] w-[5px]", "h-[13px] w-[5px] -translate-y-px"];
    case "error":
      return ["h-[6px] w-[7px]", "h-[6px] w-[7px]"];
    case "thinking":
    case "working":
      return ["h-[11px] w-[5px]", "h-[11px] w-[5px]"];
    default:
      return ["h-3 w-[5px]", "h-3 w-[5px]"];
  }
}

function expressionMotionClass(expression: EyeExpression, expressive: boolean): string {
  if (!expressive) return "";
  switch (expression) {
    case "idle":
      return "otto-eyes-idle";
    case "thinking":
    case "working":
      return "otto-eyes-working";
    case "listening":
      return "otto-eyes-listening";
    case "speaking":
      return "otto-eyes-speaking";
    case "completed":
      return "otto-eyes-completed";
    default:
      return "";
  }
}

export function Eyes({
  mini = false,
  compact = false,
  expression = "idle",
  expressive = false,
}: {
  mini?: boolean;
  compact?: boolean;
  expression?: EyeExpression;
  expressive?: boolean;
}) {
  const shapes = mini
    ? miniEyeShapes(expression)
    : compact
      ? (["h-[14px] w-[10px]", "h-[14px] w-[10px]"] as const)
      : (["h-[13px] w-1.5", "h-[13px] w-1.5"] as const);
  const eyeColor = mini ? "bg-otto-agent-eye" : compact ? "bg-otto-idle-eye" : "bg-otto-text";
  const hover =
    compact && expression === "idle"
      ? "group-hover:h-3 group-hover:w-[11px] group-hover:-translate-y-px"
      : "";
  const motion = expressionMotionClass(expression, expressive);
  const sides = ["left", "right"] as const;
  return (
    <span
      data-eye-expression={expression}
      className={`inline-flex h-[23px] flex-none items-center justify-center ${mini ? "w-[23px] gap-1.5" : compact ? "w-8 gap-2" : "w-7 gap-2"} ${motion}`}
      aria-hidden="true"
    >
      {sides.map((side) => {
        const shape = shapes[side === "left" ? 0 : 1];
        return (
          <i
            key={side}
            className={`otto-eye block flex-none rounded-[7px] ${eyeColor} transition-[height,width,transform,border-radius] duration-[190ms] ease-otto ${shape} ${hover}`}
          />
        );
      })}
    </span>
  );
}
