import { Eyes, type EyeExpression } from "./Eyes";

export function OttoLogo({
  compact = false,
  expression = "idle",
  expressive = false,
}: {
  compact?: boolean;
  expression?: EyeExpression;
  expressive?: boolean;
} = {}) {
  return (
    <span
      className={`${compact ? "h-7 w-7 rounded-otto-island" : "h-[34px] w-[34px] rounded-otto-panel"} grid place-items-center bg-otto-raised-soft text-otto-control-text transition-[background] duration-[160ms] ease-otto group-hover:bg-otto-line-mid`}
      data-otto-logo="true"
    >
      <Eyes mini={compact} compact expression={expression} expressive={expressive} />
    </span>
  );
}
