import { useCallback, useEffect, useState } from "react";
import {
  getAgentRuntimePrefs,
  togglePinnedAgentModel,
} from "../../../platform/tauri/agent-controls";
import type { AgentProvider, AgentRuntimePrefs } from "../../../platform/tauri/agent";
import { nativeAvailable } from "../../../platform/tauri/runtime";

const emptyPrefs: AgentRuntimePrefs = {
  version: 1,
  provider: "codex",
  models: {},
  thinkingEfforts: {},
  pinnedModels: {},
};

export function preferredSelectionFor(
  prefs: AgentRuntimePrefs,
  provider: AgentProvider,
): { model: string | null; effort: string | null } {
  const model = prefs.models[provider] ?? null;
  const effort =
    (model ? prefs.thinkingEfforts[`${provider}:${model}`] : null) ??
    prefs.thinkingEfforts[provider] ??
    null;
  return { model, effort };
}

export function preferredEffortFor(
  prefs: AgentRuntimePrefs,
  provider: AgentProvider,
  model: string | null,
): string | null {
  if (model && prefs.thinkingEfforts[`${provider}:${model}`]) {
    return prefs.thinkingEfforts[`${provider}:${model}`];
  }
  return prefs.thinkingEfforts[provider] ?? null;
}

export function useAgentRuntimePrefs() {
  const [prefs, setPrefs] = useState<AgentRuntimePrefs>(emptyPrefs);

  useEffect(() => {
    if (!nativeAvailable || typeof getAgentRuntimePrefs !== "function") return;
    let active = true;
    void Promise.resolve()
      .then(() => getAgentRuntimePrefs())
      .then((loaded) => {
        if (active && loaded) setPrefs(loaded);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const recordSelection = useCallback(
    (provider: AgentProvider, model: string | null, effort: string | null) => {
      setPrefs((current) => {
        const models = { ...current.models };
        if (model) models[provider] = model;
        else delete models[provider];
        const thinkingEfforts = { ...current.thinkingEfforts };
        const key = model ? `${provider}:${model}` : provider;
        if (effort) thinkingEfforts[key] = effort;
        else delete thinkingEfforts[key];
        return { ...current, provider, models, thinkingEfforts };
      });
    },
    [],
  );

  const togglePinnedModel = useCallback(async (provider: AgentProvider, modelId: string) => {
    if (!nativeAvailable || typeof togglePinnedAgentModel !== "function") {
      setPrefs((current) => {
        const existing = current.pinnedModels[provider] ?? [];
        const next = existing.includes(modelId)
          ? existing.filter((id) => id !== modelId)
          : [modelId, ...existing];
        return {
          ...current,
          pinnedModels: { ...current.pinnedModels, [provider]: next },
        };
      });
      return;
    }
    try {
      const next = await togglePinnedAgentModel(provider, modelId);
      setPrefs((current) => ({
        ...current,
        pinnedModels: { ...current.pinnedModels, [provider]: next },
      }));
    } catch {}
  }, []);

  return { prefs, recordSelection, togglePinnedModel };
}
