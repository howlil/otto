import type { TimerDurations, TimerPhase, TimerSnapshot } from "../../platform/tauri/focus";
import { Button, IconButton, Text } from "../../shared/ui";
import {
  clampDuration,
  durationBounds,
  durationNote,
  phaseChoices,
  phaseLabel,
} from "./view-model";

function withDuration(durations: TimerDurations, phase: TimerPhase, value: number): TimerDurations {
  return { ...durations, [phase]: value };
}

function DurationStepper({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex min-h-[27px] items-center justify-between gap-3">
      <Text as="span" variant="label" className="font-normal! text-otto-icon-muted">
        {label}
      </Text>
      <div className="flex items-center gap-[5px]">
        <IconButton
          icon="minus"
          label={`Decrease ${label} duration`}
          variant="outlined"
          size={13}
          className="h-[27px]! w-[27px]! border-otto-focus-stepper-line! bg-otto-focus-icon! active:scale-[0.92]"
          disabled={disabled || value === durationBounds.minimum}
          onClick={() => onChange(clampDuration(value - 1))}
        />
        <Text
          as="output"
          variant="code"
          className="min-w-[45px] text-center font-otto-focus! text-otto-sm! text-otto-focus-text tabular-nums"
        >
          {value} min
        </Text>
        <IconButton
          icon="plus"
          label={`Increase ${label} duration`}
          variant="outlined"
          size={13}
          className="h-[27px]! w-[27px]! border-otto-focus-stepper-line! bg-otto-focus-icon! active:scale-[0.92]"
          disabled={disabled || value === durationBounds.maximum}
          onClick={() => onChange(clampDuration(value + 1))}
        />
      </div>
    </div>
  );
}

export function FocusSettings({
  snapshot,
  pending,
  onConfigure,
  onDone,
}: {
  snapshot: TimerSnapshot;
  pending: boolean;
  onConfigure: (durations: TimerDurations) => Promise<boolean>;
  onDone: () => void;
}) {
  const change = (phase: TimerPhase, value: number) => {
    void onConfigure(withDuration(snapshot.durations, phase, value));
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[9px] px-[18px] pb-[15px] pt-3 animate-otto-focus-settings motion-reduce:animate-none">
      <div>
        <div className="flex items-center justify-between gap-3">
          <Text as="h2" variant="label" className="m-0 font-[550]! text-otto-focus-text">
            Session lengths
          </Text>
          <Text as="span" variant="caption" className="text-otto-label-muted">
            Focus presets
          </Text>
        </div>
        <div className="mt-[9px] flex gap-[5px]">
          {[15, 25, 50].map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={snapshot.durations.focus === value}
              disabled={pending}
              className={`min-h-6 min-w-12 rounded-full border px-3 py-[5px] text-otto-xs! leading-[normal]! transition-[background,border-color,color,transform] duration-[160ms] active:scale-[0.92] ${snapshot.durations.focus === value ? "border-otto-invert-bg-hover bg-otto-invert-bg-hover text-otto-invert-text" : "border-otto-focus-stepper-line bg-otto-field-deep text-otto-label-faded hover:bg-otto-control-hover"}`}
              onClick={() => change("focus", value)}
            >
              {value}m
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-[9px]">
        {phaseChoices.map((choice) => (
          <DurationStepper
            key={choice.value}
            label={phaseLabel(choice.value)}
            value={snapshot.durations[choice.value]}
            disabled={pending}
            onChange={(value) => change(choice.value, value)}
          />
        ))}
      </div>
      <Text
        as="p"
        variant="meta"
        className="mb-0 mt-px border-t border-otto-control-hover pt-[7px] text-otto-focus-note"
      >
        {durationNote(snapshot.status)}
        <br />
        After four focus sessions, Otto suggests a long break.
      </Text>
      <div className="mt-auto flex justify-end">
        <Button
          variant="primary"
          size="xs"
          onClick={onDone}
          className="px-[13px] py-[7px] text-otto-sm! font-normal!"
        >
          Done
        </Button>
      </div>
    </div>
  );
}
