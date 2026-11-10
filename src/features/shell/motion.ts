import type { Motion } from "./preferences";

export type NotchGeometry = {
  surface: string;
  height: number | undefined;
};

function isFirstMeasurement(previous: NotchGeometry | null, next: NotchGeometry): boolean {
  return (
    previous !== null &&
    previous.surface === next.surface &&
    previous.height === undefined &&
    next.height !== undefined
  );
}

export function shouldAnimateNotch(
  previous: NotchGeometry | null,
  next: NotchGeometry,
  reducedMotion: boolean,
): boolean {
  if (reducedMotion || previous === null) return false;
  if (previous.surface !== next.surface) return true;
  if (isFirstMeasurement(previous, next)) return false;
  return previous.height !== next.height;
}

export function isContentResize(previous: NotchGeometry | null, next: NotchGeometry): boolean {
  return (
    previous !== null &&
    previous.surface === next.surface &&
    !isFirstMeasurement(previous, next) &&
    previous.height !== next.height
  );
}

export function measuredNotchHeight(height: number): number {
  if (!Number.isFinite(height)) return 170;
  return Math.max(1, Math.min(610, Math.round(height)));
}

const morphDurations: Record<Motion, number> = { fluid: 420, gentle: 300, reduced: 0 };

export function morphDuration(motion: Motion): number {
  return morphDurations[motion];
}

export function cappedMorphDuration(durationMs: number, heightOnly: boolean): number {
  return heightOnly ? Math.min(durationMs, 170) : durationMs;
}

export function morphMilliseconds(motion: Motion): string {
  return `${morphDuration(motion)}ms`;
}

export function updateMeasuredHeights(
  current: Record<string, number>,
  page: string,
  height: number,
): Record<string, number> {
  const bounded = measuredNotchHeight(height);
  return current[page] === bounded ? current : { ...current, [page]: bounded };
}
