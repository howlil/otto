export type Expression = "calm" | "curious" | "sleepy" | "happy";

export function Eyes({
  expression = "calm",
  reactive = "quiet",
  mini = false,
}: {
  expression?: Expression;
  reactive?: "quiet" | "alive";
  mini?: boolean;
}) {
  return (
    <span
      className={`inline-flex h-[23px] w-[33px] flex-none items-center justify-center ${mini ? "w-[23px] gap-1.5" : "gap-2"}`}
      data-expression={expression}
      aria-hidden="true"
    >
      <i
        className={`block flex-none rounded-[7px] bg-otto-text transition-[height,width,transform] duration-200 ease-otto ${mini ? "h-3 w-[5px]" : expression === "curious" ? "h-[15px] w-1.5" : expression === "sleepy" ? "h-1 w-1.5" : expression === "happy" ? "h-2 w-[11px] rounded-[11px_11px_0_0] border-[2.5px] border-otto-text border-b-0 bg-transparent" : "h-[13px] w-1.5"} ${reactive === "alive" ? "motion-safe:animate-otto-blink motion-reduce:animate-none" : ""}`}
      />
      <i
        className={`block flex-none rounded-[7px] bg-otto-text transition-[height,width,transform] duration-200 ease-otto ${mini ? "h-3 w-[5px]" : expression === "curious" ? "h-[10px] w-1.5" : expression === "sleepy" ? "h-1 w-1.5" : expression === "happy" ? "h-2 w-[11px] rounded-[11px_11px_0_0] border-[2.5px] border-otto-text border-b-0 bg-transparent" : "h-[13px] w-1.5"} ${reactive === "alive" ? "motion-safe:animate-otto-blink motion-reduce:animate-none" : ""}`}
      />
    </span>
  );
}
