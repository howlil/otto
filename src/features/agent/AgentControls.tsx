// Agent-owned controls; used only by Agent views.
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
