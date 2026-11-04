import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelAgentReadiness,
  getAgentReadiness,
  nativeAvailable,
  type AgentProvider,
  type ProviderReadiness,
} from "../../platform/tauri/agent";
import { ReadinessProbeController } from "./readiness-probe";

const checking: ProviderReadiness = {
  status: "checking",
  message: "Checking provider…",
  recovery: "",
  imageInput: false,
  imageTransport: false,
  toolFreeAdmission: false,
  model: null,
  models: [],
  thinkingEffort: null,
  thinkingEfforts: [],
};

export function useProviderReadiness(
  provider: AgentProvider,
  model: string | null,
  active: boolean,
) {
  const [readiness, setReadiness] = useState<ProviderReadiness>(checking);
  const controller = useRef<ReadinessProbeController | null>(null);

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
      publish: setReadiness,
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

  const refreshProvider = useCallback(async () => {
    await controller.current?.refresh();
  }, []);

  return { readiness, refreshProvider };
}
