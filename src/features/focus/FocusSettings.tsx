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
    <div className="flex min-h-[38px] items-center justify-between gap-3 border-b border-otto-control-deep py-1.5 last:border-b-0">
      <Text as="span" variant="label" className="text-otto-text-secondary">
        {label}
      </Text>
      <div className="flex items-center gap-1.5">
        <IconButton
          icon="minus"
          label={`Decrease ${label} duration`}
          variant="outlined"
          disabled={disabled || value === durationBounds.minimum}
          onClick={() => onChange(clampDuration(value - 1))}
        />
        <Text as="output" variant="code" className="min-w-[43px] text-center text-otto-text-bright">
          {value} min
        </Text>
        <IconButton
          icon="plus"
          label={`Increase ${label} duration`}
          variant="outlined"
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
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-3 pt-3">
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <Text as="h2" variant="label" className="m-0">
            Session lengths
          </Text>
          <Text as="span" variant="caption" className="text-otto-label-muted">
            Focus presets
          </Text>
        </div>
        <div className="mt-2 flex gap-1.5">
          {[15, 25, 50].map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={snapshot.durations.focus === value}
              disabled={pending}
              className={`min-h-7 rounded-otto-chip border px-2.5 py-1 text-otto-xs transition-colors duration-[var(--otto-selection-duration)] ease-otto ${snapshot.durations.focus === value ? "border-otto-line-focused bg-otto-selected text-otto-text" : "border-otto-line-mid bg-otto-field-deep text-otto-text-secondary hover:bg-otto-control-hover"}`}
              onClick={() => change("focus", value)}
            >
              {value}m
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2">
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
      <Text as="p" variant="caption" className="mb-0 mt-2 text-otto-label-muted">
        {durationNote(snapshot.status)} After four focus sessions, Otto suggests a long break.
      </Text>
      <div className="mt-auto flex justify-end pt-2">
        <Button variant="secondary" size="xs" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
