import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  nativeAvailable,
  selectAgentProvider,
  selectAgentRuntimeOptions,
  type AgentProvider,
  type ProviderReadiness,
} from "../../platform/tauri/agent";

export function useAgentRuntimeActions({
  provider,
  model,
  readiness,
  blocked,
  setProvider,
  setModel,
  setThinkingEffort,
  clearError,
  setRequestError,
}: {
  provider: AgentProvider;
  model: string | null;
  readiness: ProviderReadiness;
  blocked: boolean;
  setProvider: Dispatch<SetStateAction<AgentProvider>>;
  setModel: Dispatch<SetStateAction<string | null>>;
  setThinkingEffort: Dispatch<SetStateAction<string | null>>;
  clearError: () => void;
  setRequestError: (reason: unknown) => void;
}) {
  const changing = useRef(false);
  const isPending = useCallback(() => changing.current, []);
  const [pending, setPending] = useState(false);
  const locked = blocked || pending;

  useEffect(() => {
    if (readiness.status !== "ready" || (model && readiness.model !== model)) return;
    setModel((current) =>
      current && readiness.models.some((option) => option.id === current)
        ? current
        : readiness.model,
    );
    setThinkingEffort((current) => {
      const selected = readiness.models.find((option) => option.id === (model ?? readiness.model));
      return selected?.thinkingEfforts.includes(current ?? "")
        ? current
        : (selected?.defaultThinkingEffort ?? readiness.thinkingEffort);
    });
  }, [model, readiness, setModel, setThinkingEffort]);

  const confirm = useCallback(
    async (nextModel: string | null, nextEffort: string | null) => {
      if (changing.current || locked) return;
      changing.current = true;
      setPending(true);
      try {
        if (provider === "pi" && nativeAvailable) {
          await selectAgentRuntimeOptions(nextModel, nextEffort);
        }
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
    [clearError, locked, provider, setModel, setRequestError, setThinkingEffort],
  );
  const selectModelValue = useCallback(
    async (next: string | null) => {
      const selected = readiness.models.find((option) => option.id === next);
      const effort = selected?.defaultThinkingEffort ?? null;
      await confirm(next, effort);
    },
    [confirm, readiness.models],
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
        setProvider(next);
        setModel(null);
        setThinkingEffort(null);
        clearError();
      } catch (error) {
        setRequestError(error);
      } finally {
        changing.current = false;
        setPending(false);
      }
    },
    [clearError, locked, provider, setModel, setProvider, setRequestError, setThinkingEffort],
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
