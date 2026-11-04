export type SubmittedDraft = {
  text: string;
  epoch: number;
  acceptedRunId: number | null;
};

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
  if (observedRunId !== submitted.acceptedRunId || accepted || currentEpoch !== submitted.epoch) {
    return current;
  }
  return current || submitted.text;
}
