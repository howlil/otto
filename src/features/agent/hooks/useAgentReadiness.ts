import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelAgentReadiness,
  getAgentReadiness,
  listAgentProviders,
  type AgentProvider,
  type AgentProviderDescriptor,
  type ProviderReadiness,
} from "../../../platform/tauri/agent";
import { refreshAgentProviders, warmAgentProvider } from "../../../platform/tauri/agent-controls";
import { nativeAvailable } from "../../../platform/tauri/runtime";
import { ReadinessProbeController } from "../model/readiness-probe";

const checking: ProviderReadiness = {
  status: "checking",
  message: "Checking provider…",
  recovery: "",
  imageInput: false,
  imageTransport: false,
  model: null,
  models: [],
  thinkingEffort: null,
  thinkingEfforts: [],
  rateLimits: [],
};

function useWarmReadyProvider(active: boolean, provider: AgentProvider, ready: boolean) {
  useEffect(() => {
    if (!active || !nativeAvailable || !ready || !provider) return;
    void Promise.resolve()
      .then(() => warmAgentProvider())
      .catch(() => {});
  }, [active, provider, ready]);
}

function createReadinessController(
  activeTarget: { current: { provider: AgentProvider; model: string | null } },
  publish: (next: {
    provider: AgentProvider;
    model: string | null;
    readiness: ProviderReadiness;
  }) => void,
  onRefreshing: (refreshing: boolean) => void,
) {
  const unavailable: ProviderReadiness = {
    ...checking,
    status: "unavailable",
    message: "Provider readiness requires the Otto desktop app.",
    recovery: "Open Otto on Windows.",
  };
  const failed: ProviderReadiness = {
    ...checking,
    status: "unavailable",
    message: "Could not check provider readiness.",
    recovery: "Retry the connection.",
  };
  return new ReadinessProbeController({
    read: ({ provider, model }, requestId, force) =>
      nativeAvailable
        ? getAgentReadiness(provider, requestId, model, Boolean(force))
        : Promise.resolve(unavailable),
    cancel: (requestId) => (nativeAvailable ? cancelAgentReadiness(requestId) : Promise.resolve()),
    publish: (next) =>
      publish({
        provider: activeTarget.current.provider,
        model: activeTarget.current.model,
        readiness: next,
      }),
    onRefreshing,
    checking,
    failed,
  });
}

export function useProviderReadiness(
  provider: AgentProvider,
  model: string | null,
  active: boolean,
  warmActive = active,
) {
  const activeTarget = useRef({ provider, model });
  activeTarget.current = { provider, model };
  const [state, setState] = useState<{
    provider: AgentProvider;
    model: string | null;
    readiness: ProviderReadiness;
  }>({
    provider,
    model,
    readiness: checking,
  });
  const [refreshing, setRefreshing] = useState(false);
  const readinessMatches =
    state.provider === provider &&
    (state.model === model ||
      (state.readiness.status === "ready" &&
        (model === state.readiness.model ||
          (model !== null && state.readiness.models.some((option) => option.id === model)))));
  const readiness = readinessMatches ? state.readiness : checking;
  const controller = useRef<ReadinessProbeController | null>(null);
  const [providers, setProviders] = useState<AgentProviderDescriptor[]>([]);

  const refreshCatalog = useCallback(async () => {
    if (!nativeAvailable) {
      setProviders([]);
      return;
    }
    try {
      setProviders(await listAgentProviders());
    } catch {
      setProviders([]);
    }
  }, []);

  useEffect(() => {
    const probe = createReadinessController(activeTarget, setState, setRefreshing);
    controller.current = probe;
    return () => {
      probe.dispose();
      if (controller.current === probe) controller.current = null;
    };
  }, []);

  useEffect(() => {
    controller.current?.update(active ? { provider, model } : null);
  }, [active, provider, model]);

  useEffect(() => {
    if (active) void refreshCatalog();
  }, [active, refreshCatalog]);

  useWarmReadyProvider(warmActive, provider, readiness.status === "ready");

  const refreshProvider = useCallback(async () => {
    await Promise.all([refreshCatalog(), controller.current?.refresh()]);
  }, [refreshCatalog]);

  const refreshPath = useCallback(async () => {
    if (!nativeAvailable) {
      setProviders([]);
      return;
    }
    controller.current?.clearCache();
    try {
      setProviders(await refreshAgentProviders());
    } catch {
      setProviders([]);
    }
    await controller.current?.refresh();
  }, []);

  return { readiness, refreshing, providers, refreshProvider, refreshPath };
}
