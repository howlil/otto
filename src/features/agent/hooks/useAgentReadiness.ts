import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelAgentReadiness,
  getAgentReadiness,
  listAgentProviders,
  type AgentProvider,
  type AgentProviderDescriptor,
  type ProviderReadiness,
} from "../../../platform/tauri/agent";
import { refreshAgentProviders } from "../../../platform/tauri/agent-controls";
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

export function useProviderReadiness(
  provider: AgentProvider,
  model: string | null,
  active: boolean,
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
  const readinessMatches =
    state.provider === provider &&
    (state.model === model ||
      (state.model === null &&
        state.readiness.status === "ready" &&
        model === state.readiness.model));
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
    const probe = new ReadinessProbeController({
      read: ({ provider, model }, requestId) =>
        nativeAvailable
          ? getAgentReadiness(provider, requestId, model)
          : Promise.resolve(unavailable),
      cancel: (requestId) =>
        nativeAvailable ? cancelAgentReadiness(requestId) : Promise.resolve(),
      publish: (next) =>
        setState({
          provider: activeTarget.current.provider,
          model: activeTarget.current.model,
          readiness: next,
        }),
      checking,
      failed,
    });
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

  const refreshProvider = useCallback(async () => {
    await Promise.all([refreshCatalog(), controller.current?.refresh()]);
  }, [refreshCatalog]);

  const refreshPath = useCallback(async () => {
    if (!nativeAvailable) {
      setProviders([]);
      return;
    }
    try {
      setProviders(await refreshAgentProviders());
    } catch {
      setProviders([]);
    }
    await controller.current?.refresh();
  }, []);

  return { readiness, providers, refreshProvider, refreshPath };
}
