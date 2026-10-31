import { useEffect, useState } from "react";
import { AgentPanel } from "./features/agent/AgentPanel";
import { useAgent } from "./features/agent/useAgent";
import { setNotchSurface } from "./platform/tauri";

export default function App() {
  const agent = useAgent();
  const [active, setActive] = useState<"home" | "agent">("home");
  const [expanded, setExpanded] = useState(false);
  const [pinned, setPinned] = useState(false);
  const isAgentCompact = active === "agent";
  const surface = expanded ? active : isAgentCompact ? "agentCompact" : "idle";

  useEffect(() => {
    void setNotchSurface(surface).catch(() => {
      // A surface request can fail on an unsupported desktop configuration.
      // Keep the UI operable; do not claim native positioning succeeded.
    });
  }, [surface]);

  const collapse = () => { setExpanded(false); setPinned(false); };
  const home = () => { setExpanded(true); setPinned(true); setActive("home"); };
  const agentOpen = () => { setActive("agent"); setExpanded(true); setPinned(true); };

  return (
    <main className="h-full w-full bg-transparent text-otto-text"
      onMouseEnter={() => { if (!pinned) setExpanded(true); }}
      onMouseLeave={() => { if (!pinned) setExpanded(false); }}
      onKeyDown={(event) => { if (event.key === "Escape") collapse(); }}>
      {!expanded ? (
        <button type="button" onClick={isAgentCompact ? agentOpen : home}
          aria-label={isAgentCompact ? "Open Codex" : "Open Otto"}
          className="flex h-full w-full items-center justify-center gap-3 rounded-otto-island bg-otto-surface px-3 focus-visible:outline">
          {isAgentCompact ? (
            <>
              <span className="text-xs font-semibold">Codex</span>
              <span className="truncate text-[11px] text-otto-muted">
                {agent.snapshot.status === "completed" ? "Answer ready" : agent.snapshot.status}
              </span>
            </>
          ) : (
            <span aria-hidden="true" className="flex gap-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-otto-text" />
              <span className="h-2.5 w-2.5 rounded-full bg-otto-text" />
            </span>
          )}
        </button>
      ) : active === "agent" ? (
        <AgentPanel agent={agent} onBack={home} />
      ) : (
        <section className="flex h-full flex-col rounded-[28px] bg-otto-surface p-4" aria-label="Otto Home">
          <header className="flex items-center justify-between">
            <span className="text-sm font-semibold">Otto</span>
            <button type="button" onClick={collapse} aria-label="Collapse Otto" className="rounded-lg px-2 text-otto-muted hover:text-otto-text">×</button>
          </header>
          <div className="mt-3 grid flex-1 grid-cols-3 gap-2">
            <button type="button" onClick={agentOpen} className="rounded-xl bg-[#292929] px-2 py-2 text-xs font-medium focus-visible:outline">
              Codex
              <span className="mt-1 block text-[10px] font-normal text-otto-muted">Quick Ask</span>
            </button>
            <button type="button" disabled className="rounded-xl bg-[#292929] px-2 py-2 text-xs text-otto-muted opacity-50">Music</button>
            <button type="button" disabled className="rounded-xl bg-[#292929] px-2 py-2 text-xs text-otto-muted opacity-50">Focus</button>
          </div>
        </section>
      )}
    </main>
  );
}
