export type Expression = "calm" | "curious" | "sleepy" | "happy";

const eyeShapes: Record<Expression, readonly [string, string]> = {
  calm: ["h-[13px] w-1.5", "h-[13px] w-1.5"],
  curious: ["h-[15px] w-1.5", "h-[10px] w-1.5"],
  sleepy: ["h-1 w-1.5", "h-1 w-1.5"],
  happy: [
    "h-2 w-[11px] rounded-[11px_11px_0_0] border-[2.5px] border-otto-text border-b-0 bg-transparent",
    "h-2 w-[11px] rounded-[11px_11px_0_0] border-[2.5px] border-otto-text border-b-0 bg-transparent",
  ],
};

export function Eyes({
  expression = "calm",
  reactive = "quiet",
  mini = false,
  compact = false,
}: {
  expression?: Expression;
  reactive?: "quiet" | "alive";
  mini?: boolean;
  compact?: boolean;
}) {
  const shapes = mini
    ? (["h-3 w-[5px]", "h-3 w-[5px]"] as const)
    : compact && expression === "calm"
      ? (["h-[14px] w-[10px]", "h-[14px] w-[10px]"] as const)
      : eyeShapes[expression];
  const motion = reactive === "alive" ? "motion-safe:animate-otto-blink motion-reduce:animate-none" : "";
  return (
    <span
      className={`inline-flex h-[23px] flex-none items-center justify-center ${mini ? "w-[23px] gap-1.5" : compact ? "w-[44px] gap-[17px]" : "w-[33px] gap-2"}`}
      data-expression={expression}
      aria-hidden="true"
    >
      {shapes.map((shape, index) => (
        <i
          key={index}
          className={`block flex-none rounded-[7px] bg-otto-text transition-[height,width,transform] duration-200 ease-otto ${shape} ${motion}`}
        />
      ))}
    </span>
  );
}
