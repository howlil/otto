import { useCallback, useEffect, useRef, useState } from "react";
import {
  askCodex,
  getCodexReadiness,
  decideAgentApproval,
  getAgentSnapshot,
  nativeAvailable,
  newAgentSession,
  stopCodex,
  subscribeAgent,
  type AgentMode,
  type AgentSnapshot,
  type ProviderReadiness,
} from "../../platform/tauri";

const initial: AgentSnapshot = {
  runId: 0,
  seq: 0,
  status: "idle",
  mode: "quickAsk",
  cwd: "",
  threadId: null,
  messages: [],
  error: null,
};

const checking: ProviderReadiness = {
  status: "checking",
  message: "Checking Codex…",
  recovery: "",
  imageInput: false,
};

export function useAgent() {
  const [snapshot, setSnapshot] = useState<AgentSnapshot>(initial);
  const [readiness, setReadiness] = useState<ProviderReadiness>(checking);
  const installed = readiness.status === "checking" ? null : readiness.status === "ready";
  const [draft, setDraft] = useState("");
  const [cwd, setCwd] = useState("");
  // UI-local settings draft. The effective mode after submit comes from Rust.
  const [mode, setMode] = useState<AgentMode>("quickAsk");
  const [error, setError] = useState<string | null>(null);
  const submitted = useRef<string | null>(null);
  const subscription = useRef<Awaited<ReturnType<typeof subscribeAgent>> | null>(null);
  const projectRef = useRef("");
  const providerProbe = useRef(0);

  const refreshProvider = useCallback(async () => {
    const probe = ++providerProbe.current;
    setReadiness(checking);
    if (!nativeAvailable) {
      setReadiness({
        status: "unavailable",
        message: "Codex readiness requires the Otto desktop app.",
        recovery: "Open Otto on Windows.",
        imageInput: false,
      });
      return;
    }
    try {
      const status = await getCodexReadiness(projectRef.current || undefined);
      if (providerProbe.current === probe) setReadiness(status);
    } catch {
      if (providerProbe.current === probe) {
        setReadiness({
          status: "unavailable",
          message: "Could not check Codex readiness.",
          recovery: "Retry the connection.",
          imageInput: false,
        });
      }
    }
  }, []);

  useEffect(() => {
    if (!nativeAvailable) return;
    let mounted = true;
    const receive = (next: AgentSnapshot) => {
      if (!mounted) return;
      setSnapshot((prev) => (next.seq >= prev.seq ? next : prev));
    };
    void subscribeAgent(receive)
      .then((channel) => {
        if (mounted) subscription.current = channel;
      })
      .catch(() => {
        if (mounted) setError("Cannot listen to Codex events.");
      });
    void getAgentSnapshot()
      .then((value) => {
        receive(value);
        if (mounted) {
          setCwd((old) => old || value.cwd);
          // A resumed conversation keeps its fixed mode; the UI draft follows it.
          setMode(value.threadId ? value.mode : "quickAsk");
        }
      })
      .catch(() => {
        if (mounted) setError("Cannot connect to the Otto desktop process.");
      });
    return () => {
      mounted = false;
      subscription.current = null;
    };
  }, [refreshProvider]);

  // A project setting can alter the model catalog. Debounce edits and ignore
  // responses from a previously selected working directory.
  useEffect(() => {
    projectRef.current = cwd;
    providerProbe.current += 1;
    setReadiness(checking);
    const timer = setTimeout(() => void refreshProvider(), 350);
    return () => clearTimeout(timer);
  }, [cwd, refreshProvider]);

  useEffect(() => {
    if (snapshot.status === "failed" && submitted.current) {
      const wasAccepted = snapshot.messages.some(
        (message) => message.role === "user" && message.text === submitted.current,
      );
      if (!wasAccepted) setDraft((old) => old || submitted.current || "");
      submitted.current = null;
    }
    if (snapshot.status === "completed" || snapshot.status === "stopped") {
      submitted.current = null;
    }
  }, [snapshot.status, snapshot.messages]);

  const busy = ["starting", "streaming", "stopping", "approvalRequired"].includes(snapshot.status);
  // Mode and working folder are locked once the conversation exists.
  const locked = busy || snapshot.threadId !== null;

  const send = async () => {
    const question = draft.trim();
    if (!question || busy) return;
    setError(null);
    submitted.current = question;
    try {
      await askCodex(question, cwd, mode);
      setDraft("");
    } catch (reason) {
      submitted.current = null;
      setError(String(reason));
      void refreshProvider();
    }
  };

  const stop = async () => {
    setError(null);
    try {
      await stopCodex();
    } catch (reason) {
      setError(String(reason));
    }
  };

  const newSession = async () => {
    if (busy) return false;
    setError(null);
    try {
      await newAgentSession();
      submitted.current = null;
      setMode("quickAsk");
      // Keep the user's unsent draft and project selection for the next run.
      return true;
    } catch (reason) {
      setError(String(reason));
      return false;
    }
  };

  const decide = async (approvalId: string, decision: "allowOnce" | "deny") => {
    setError(null);
    try {
      await decideAgentApproval(approvalId, decision);
      return true;
    } catch (reason) {
      setError(String(reason));
      return false;
    }
  };

  return {
    snapshot,
    installed,
    readiness,
    draft,
    setDraft,
    cwd,
    setCwd,
    mode,
    setMode,
    locked,
    error: error ?? snapshot.error,
    busy,
    send,
    stop,
    newSession,
    decide,
    refreshProvider,
  };
}
