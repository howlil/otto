// The idle eyes. A visual primitive with expression state; used by the compact
// capsule and the Home header, so it lives with the shared primitives.
export type Expression = "calm" | "curious" | "sleepy" | "happy";

export function Eyes({
  expression = "calm",
  reactive = "quiet",
}: {
  expression?: Expression;
  reactive?: "quiet" | "alive";
}) {
  return (
    <span
      className={`otto-eyes${reactive === "alive" ? " alive" : ""}`}
      data-expression={expression}
      aria-hidden="true"
    >
      <i />
      <i />
    </span>
  );
}
