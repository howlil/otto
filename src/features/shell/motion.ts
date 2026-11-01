export type NotchGeometry = {
  surface: string;
  height: number | undefined;
};

export function shouldAnimateNotch(
  previous: NotchGeometry | null,
  next: NotchGeometry,
  reducedMotion: boolean,
): boolean {
  return (
    !reducedMotion &&
    previous !== null &&
    (previous.surface !== next.surface || previous.height !== next.height)
  );
}

export function isContentResize(previous: NotchGeometry | null, next: NotchGeometry): boolean {
  return previous !== null && previous.surface === next.surface && previous.height !== next.height;
}

export function measuredNotchHeight(height: number): number {
  if (!Number.isFinite(height)) return 170;
  return Math.max(1, Math.min(610, Math.ceil(height / 8) * 8));
}

export function updateMeasuredHeights(
  current: Record<string, number>,
  page: string,
  height: number,
): Record<string, number> {
  const bounded = measuredNotchHeight(height);
  return current[page] === bounded ? current : { ...current, [page]: bounded };
}
