import { useCallback, useEffect, useRef, useState } from "react";
import {
  askCodex,
  codexInstalled,
  decideAgentApproval,
  getAgentSnapshot,
  nativeAvailable,
  stopCodex,
  subscribeAgent,
  type AgentMode,
  type AgentSnapshot,
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

export function useAgent() {
  const [snapshot, setSnapshot] = useState<AgentSnapshot>(initial);
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [cwd, setCwd] = useState("");
  // UI-local settings draft. The effective mode after submit comes from Rust.
  const [mode, setMode] = useState<AgentMode>("quickAsk");
  const [error, setError] = useState<string | null>(null);
  const submitted = useRef<string | null>(null);
  const subscription = useRef<Awaited<ReturnType<typeof subscribeAgent>> | null>(null);

  const refreshProvider = useCallback(async () => {
    if (!nativeAvailable) {
      setInstalled(false);
      return;
    }
    try {
      setInstalled(await codexInstalled());
    } catch {
      setInstalled(false);
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
    void refreshProvider();
    return () => {
      mounted = false;
      subscription.current = null;
    };
  }, [refreshProvider]);

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
    decide,
    refreshProvider,
  };
}
