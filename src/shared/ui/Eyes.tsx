export function Eyes({ mini = false, compact = false }: { mini?: boolean; compact?: boolean }) {
  const shapes = mini
    ? (["h-3 w-[5px]", "h-3 w-[5px]"] as const)
    : compact
      ? (["h-[14px] w-[10px]", "h-[14px] w-[10px]"] as const)
      : (["h-[13px] w-1.5", "h-[13px] w-1.5"] as const);
  const eyeColor = mini ? "bg-otto-agent-eye" : compact ? "bg-otto-idle-eye" : "bg-otto-text";
  const hover = compact ? "group-hover:h-3 group-hover:w-[11px] group-hover:-translate-y-px" : "";
  const sides = ["left", "right"] as const;
  return (
    <span
      className={`inline-flex h-[23px] flex-none items-center justify-center ${mini ? "w-[23px] gap-1.5" : compact ? "w-8 gap-2" : "w-7 gap-2"}`}
      aria-hidden="true"
    >
      {sides.map((side) => {
        const shape = shapes[side === "left" ? 0 : 1];
        return (
          <i
            key={side}
            className={`block flex-none rounded-[7px] ${eyeColor} transition-[height,width,transform] duration-[190ms] ease-otto ${shape} ${hover}`}
          />
        );
      })}
    </span>
  );
}
