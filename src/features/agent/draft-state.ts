export type SubmittedDraft = { text: string; epoch: number; previousRunId: number };

export function clearAcceptedDraft(
  current: string,
  currentEpoch: number,
  submitted: SubmittedDraft,
): string {
  return currentEpoch === submitted.epoch ? "" : current;
}

export function restoreRejectedDraft(
  current: string,
  currentEpoch: number,
  submitted: SubmittedDraft,
  observedRunId: number,
  accepted: boolean,
): string {
  if (observedRunId <= submitted.previousRunId || accepted || currentEpoch !== submitted.epoch) {
    return current;
  }
  return current || submitted.text;
}
