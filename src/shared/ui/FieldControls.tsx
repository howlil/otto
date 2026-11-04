import type { ComponentPropsWithRef } from "react";
import { Text } from "./Text";

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
  help?: string;
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
        {help && (
          <Text as="small" variant="meta" className="mt-1 block text-otto-label-muted">
            {help}
          </Text>
        )}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
      />
      <i
        className="relative h-[18px] w-[30px] flex-none rounded-full border border-otto-switch-border bg-otto-switch-track transition-colors duration-200 after:absolute after:left-0.5 after:top-0.5 after:h-3 after:w-3 after:rounded-full after:bg-otto-icon-muted after:transition-transform after:duration-200 after:content-[''] peer-checked:bg-otto-switch-enabled peer-checked:after:translate-x-3 peer-checked:after:bg-otto-knob"
        aria-hidden="true"
      />
    </label>
  );
}
