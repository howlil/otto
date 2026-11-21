import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  selectAgentProvider,
  selectAgentRuntimeOptions,
  type AgentProvider,
  type AgentRuntimePrefs,
  type ProviderReadiness,
} from "../../../platform/tauri/agent";
import { nativeAvailable } from "../../../platform/tauri/runtime";
import { preferredEffortFor, preferredSelectionFor } from "./useAgentRuntimePrefs";

function pickEffort(efforts: string[], candidates: Array<string | null>): string | null {
  for (const candidate of candidates) {
    if (candidate && efforts.includes(candidate)) return candidate;
  }
  return null;
}

function resolveReadyThinkingEffort(
  readiness: ProviderReadiness,
  resolvedModel: string | null,
  current: string | null,
  saved: string | null,
): string | null {
  const selected = readiness.models.find((option) => option.id === resolvedModel);
  if (!selected) {
    return pickEffort(readiness.thinkingEfforts, [current, saved]) ?? readiness.thinkingEffort;
  }
  const singleOff = selected.thinkingEfforts.length === 1 && selected.thinkingEfforts[0] === "off";
  const efforts = singleOff ? [] : selected.thinkingEfforts;
  if (efforts.length === 0) return null;
  const nativeEffort = selected.id === readiness.model ? readiness.thinkingEffort : null;
  return pickEffort(efforts, [current, saved, nativeEffort]) ?? selected.defaultThinkingEffort;
}

export function useAgentRuntimeActions({
  provider,
  model,
  readiness,
  prefs,
  blocked,
  setProvider,
  setModel,
  setThinkingEffort,
  recordSelection,
  clearError,
  setRequestError,
}: {
  provider: AgentProvider;
  model: string | null;
  readiness: ProviderReadiness;
  prefs: AgentRuntimePrefs;
  blocked: boolean;
  setProvider: Dispatch<SetStateAction<AgentProvider>>;
  setModel: Dispatch<SetStateAction<string | null>>;
  setThinkingEffort: Dispatch<SetStateAction<string | null>>;
  recordSelection: (provider: AgentProvider, model: string | null, effort: string | null) => void;
  clearError: () => void;
  setRequestError: (reason: unknown) => void;
}) {
  const changing = useRef(false);
  const isPending = useCallback(() => changing.current, []);
  const [pending, setPending] = useState(false);
  const locked = blocked || pending;

  useEffect(() => {
    if (readiness.status !== "ready") return;
    if (readiness.models.length === 0 && model && readiness.model !== model) return;
    if (
      model &&
      readiness.models.length > 0 &&
      !readiness.models.some((option) => option.id === model)
    ) {
      return;
    }
    const fallbackModel =
      readiness.models.find((option) => option.id === readiness.model)?.id ??
      readiness.models[0]?.id ??
      readiness.model;
    const resolvedModel =
      model && readiness.models.some((option) => option.id === model) ? model : fallbackModel;
    const savedEffort = preferredEffortFor(prefs, provider, resolvedModel);
    setModel((current) =>
      current && readiness.models.some((option) => option.id === current) ? current : fallbackModel,
    );
    setThinkingEffort((current) =>
      resolveReadyThinkingEffort(readiness, resolvedModel, current, savedEffort),
    );
  }, [model, prefs, provider, readiness, setModel, setThinkingEffort]);

  const confirm = useCallback(
    async (nextModel: string | null, nextEffort: string | null) => {
      if (changing.current || locked) return;
      changing.current = true;
      setPending(true);
      try {
        if (nativeAvailable && typeof selectAgentRuntimeOptions === "function") {
          await selectAgentRuntimeOptions(nextModel, nextEffort);
        }
        recordSelection(provider, nextModel, nextEffort);
        setModel(nextModel);
        setThinkingEffort(nextEffort);
        clearError();
      } catch (reason) {
        setRequestError(reason);
      } finally {
        changing.current = false;
        setPending(false);
      }
    },
    [clearError, locked, provider, recordSelection, setModel, setRequestError, setThinkingEffort],
  );
  const selectModelValue = useCallback(
    async (next: string | null) => {
      const selected = readiness.models.find((option) => option.id === next);
      const savedEffort = preferredEffortFor(prefs, provider, next);
      const efforts = selected?.thinkingEfforts ?? [];
      const effort =
        savedEffort && efforts.includes(savedEffort)
          ? savedEffort
          : (selected?.defaultThinkingEffort ?? null);
      await confirm(next, effort);
    },
    [confirm, prefs, provider, readiness.models],
  );
  const selectThinkingEffortValue = useCallback(
    async (next: string | null) => {
      await confirm(model ?? readiness.model, next);
    },
    [confirm, model, readiness.model],
  );
  const selectProviderValue = useCallback(
    async (next: AgentProvider) => {
      if (locked || changing.current || next === provider) return;
      changing.current = true;
      setPending(true);
      try {
        if (nativeAvailable) await selectAgentProvider(next);
        const restored = preferredSelectionFor(prefs, next);
        setProvider(next);
        setModel(restored.model);
        setThinkingEffort(restored.effort);
        clearError();
      } catch (error) {
        setRequestError(error);
      } finally {
        changing.current = false;
        setPending(false);
      }
    },
    [
      clearError,
      locked,
      prefs,
      provider,
      setModel,
      setProvider,
      setRequestError,
      setThinkingEffort,
    ],
  );

  return {
    pending,
    isPending,
    locked,
    selectProvider: selectProviderValue,
    selectModel: selectModelValue,
    selectThinkingEffort: selectThinkingEffortValue,
  };
}
