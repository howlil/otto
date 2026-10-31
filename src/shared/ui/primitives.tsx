// Shared visual primitives. Each had 2+ near-identical copies (a class rule per
// surface plus an inline component), so they live here once and are composed by
// features. Render-only: props in, events out, no IPC and no feature imports.

export function Bars({ className = "" }: { className?: string }) {
  return (
    <span className={`otto-bars live ${className}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

export type Choice<T extends string> = { value: T; label: string };

export function ChoiceChip<T extends string>({
  value,
  choices,
  onChange,
  disabled,
}: {
  value: T;
  choices: readonly Choice<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="otto-picks flex flex-wrap gap-[6px]">
      {choices.map((choice) => (
        <button
          type="button"
          key={choice.value}
          aria-pressed={value === choice.value}
          className={value === choice.value ? "selected" : ""}
          disabled={disabled}
          onClick={() => onChange(choice.value)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

export function Range({
  label,
  value,
  min,
  max,
  unit,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="otto-setting-range">
      <span>
        {label}
        <output>
          {value}
          {unit}
        </output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function Toggle({
  title,
  help,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  help: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="otto-setting-toggle flex cursor-pointer items-center justify-between gap-[10px]">
      <span>
        <strong>{title}</strong>
        <small>{help}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <i aria-hidden="true" />
    </label>
  );
}

// A repeated choice row with a radio tick: used by execution mode now, and by
// any future exclusive list with a title + explanation.
export function ChoiceRow<T extends string>({
  value,
  choices,
  onChange,
  disabled,
  disabledReason,
}: {
  value: T;
  choices: readonly { value: T; title: string; help: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <div className="otto-mode-list flex flex-col gap-[6px]">
      {choices.map((choice) => (
        <button
          type="button"
          key={choice.value}
          className={value === choice.value ? "selected" : ""}
          aria-pressed={value === choice.value}
          disabled={disabled}
          title={disabled ? disabledReason : undefined}
          onClick={() => onChange(choice.value)}
        >
          <i className="otto-mode-radio" />
          <span>
            <strong>{choice.title}</strong>
            <small>{choice.help}</small>
          </span>
        </button>
      ))}
    </div>
  );
}
