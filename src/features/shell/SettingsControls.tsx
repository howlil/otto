// Shell-owned settings controls; no cross-feature consumer.
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
