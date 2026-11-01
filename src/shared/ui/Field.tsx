import type { ComponentPropsWithRef, ComponentPropsWithoutRef } from "react";
import { Text } from "./Text";

export type Choice<T extends string> = {
  value: T;
  label: string;
  help?: string;
  disabled?: boolean;
  disabledReason?: string;
};

type ChoiceGroupProps<T extends string> = {
  value: T;
  choices: readonly Choice<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  disabledReason?: string;
};

export function ChoiceGroup<T extends string>({
  value,
  choices,
  onChange,
  presentation = "chip",
  disabled,
  disabledReason,
}: ChoiceGroupProps<T> & {
  presentation?: "chip" | "row";
}) {
  if (presentation === "row") {
    return (
      <div className="flex flex-col gap-1.5">
        {choices.map((choice) => {
          const selected = value === choice.value;
          const unavailable = disabled || choice.disabled;
          return (
            <button
              type="button"
              key={choice.value}
              className={`flex min-h-[45px] w-full items-center gap-2.5 rounded-otto-control border px-[11px] py-[9px] text-left text-otto-hover-text ${selected ? "border-otto-line-muted bg-otto-control-deep" : "border-otto-line-mid bg-otto-field-deep"} ${unavailable ? "opacity-50" : ""}`}
              aria-pressed={selected}
              disabled={unavailable}
              title={unavailable ? (choice.disabled ? choice.disabledReason : disabledReason) : undefined}
              onClick={() => onChange(choice.value)}
            >
              <span className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border border-otto-disabled-outline">
                {selected && <span className="h-1.5 w-1.5 rounded-full bg-otto-control-text" />}
              </span>
              <span className="min-w-0">
                <Text as="strong" variant="label" className="block">
                  {choice.label}
                </Text>
                {choice.help && (
                  <Text
                    as="small"
                    variant="meta"
                    className="mt-0.5 block leading-[1.35] text-otto-text-subtle"
                  >
                    {choice.help}
                  </Text>
                )}
              </span>
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {choices.map((choice) => (
        <button
          type="button"
          key={choice.value}
          className={`min-h-7 rounded-otto-chip border px-2.5 py-[7px] text-otto-xs ${value === choice.value ? "border-otto-line-focused bg-otto-selected-hover text-otto-invert-line" : "border-otto-line-mid bg-otto-field-deep text-otto-text-secondary hover:bg-otto-control-hover"}`}
          aria-pressed={value === choice.value}
          disabled={disabled || choice.disabled}
          title={choice.disabled ? choice.disabledReason : disabled ? disabledReason : undefined}
          onClick={() => onChange(choice.value)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

export function SegmentedControl<T extends string>(props: ChoiceGroupProps<T>) {
  return <ChoiceGroup {...props} presentation="chip" />;
}

export function RadioGroup<T extends string>(props: ChoiceGroupProps<T>) {
  return <ChoiceGroup {...props} presentation="row" />;
}

export function TextField(props: ComponentPropsWithoutRef<"input">) {
  return <input {...props} />;
}

export function TextArea(props: ComponentPropsWithRef<"textarea">) {
  return <textarea {...props} />;
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
    <label className="my-[13px] block">
      <Text
        as="span"
        variant="meta"
        className="flex justify-between gap-2 text-otto-settings-label"
      >
        {label}
        <Text as="output" variant="meta" className="text-otto-label-muted">
          {value}
          {unit}
        </Text>
      </Text>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 block h-[17px] w-full cursor-pointer accent-otto-input-selected"
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
    <label className="flex min-h-[51px] cursor-pointer items-center justify-between gap-[10px] border-b border-otto-control-deep py-[9px]">
      <span>
        <Text as="strong" variant="label" className="block">
          {title}
        </Text>
        <Text as="small" variant="meta" className="mt-1 block text-otto-label-muted">
          {help}
        </Text>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
      />
      <i
        className="relative h-[18px] w-[30px] flex-none rounded-full border border-otto-switch-border bg-otto-switch-track transition-colors duration-200 after:absolute after:left-0.5 after:top-0.5 after:h-3 after:w-3 after:rounded-full after:bg-otto-icon-muted after:transition-transform after:duration-200 after:content-[''] peer-checked:bg-otto-switch-enabled peer-checked:after:translate-x-3 peer-checked:after:bg-otto-knob peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-otto-focus peer-focus-visible:outline-offset-2"
        aria-hidden="true"
      />
    </label>
  );
}
