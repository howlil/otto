import { useEffect, useRef } from "react";
import type { ReturnTypeOfUseAgent } from "./types";

export function AgentPanel({ agent, onBack }: { agent: ReturnTypeOfUseAgent; onBack: () => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { snapshot, installed, cwd, setCwd, draft, setDraft, error, busy, send, stop, refreshProvider } = agent;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "auto" });
  }, [snapshot.seq]);

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void send();
  };

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[28px] bg-otto-surface p-4 text-otto-text" aria-label="Codex Quick Ask">
      <header className="flex shrink-0 items-center justify-between gap-3">
        <button type="button" aria-label="Back to Home" onClick={onBack} className="rounded-lg px-2 py-1 text-otto-muted hover:text-otto-text focus-visible:outline">
          ←
        </button>
        <div className="flex-1 text-center">
          <div className="text-sm font-semibold">Codex · Quick Ask</div>
          <div className="text-[11px] text-otto-muted">Read-only sandbox · no automatic approvals</div>
        </div>
        <button type="button" onClick={() => void refreshProvider()} className="rounded-lg px-2 py-1 text-xs text-otto-muted hover:text-otto-text">
          Retry
        </button>
      </header>

      <label className="mt-2 flex shrink-0 items-center gap-2 text-[11px] text-otto-muted">
        <span className="shrink-0">Context</span>
        <input
          aria-label="Working directory"
          value={cwd}
          onChange={(event) => setCwd(event.target.value)}
          disabled={busy || snapshot.threadId !== null}
          className="min-w-0 flex-1 rounded-lg bg-[#292929] px-2 py-1 text-otto-text outline-offset-2 focus-visible:outline"
          placeholder="Absolute project folder"
        />
      </label>

      <div ref={scrollRef} role="log" aria-live="polite" aria-relevant="additions text"
        className="my-2 min-h-0 flex-1 space-y-2 overflow-y-auto text-xs leading-relaxed">
        {snapshot.messages.length === 0 && (
          <p className="rounded-lg p-3 text-otto-muted">
            Ask Codex without leaving your desktop. Otto checks your local CLI when you send.
          </p>
        )}
        {snapshot.messages.map((message, index) => (
          <div key={index} className={message.role === "user" ? "ml-8 rounded-xl bg-[#292929] p-2.5" : "mr-3 rounded-xl p-2.5"}>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-otto-muted">{message.role === "user" ? "You" : "Codex"}</p>
            <div className="whitespace-pre-wrap break-words">{message.text || (busy ? "Thinking…" : "")}</div>
            {message.role === "assistant" && message.text && snapshot.status === "completed" && index === snapshot.messages.length - 1 && (
              <button type="button" onClick={() => void navigator.clipboard.writeText(message.text)}
                className="mt-2 text-[11px] text-otto-muted hover:text-otto-text">Copy answer</button>
            )}
          </div>
        ))}
      </div>

      {error && (
        <div role="alert" className="mb-2 shrink-0 rounded-lg bg-[#392525] px-2 py-1.5 text-xs text-[#ffbbbb]">
          {error} {installed === false && "Install Codex CLI or check PATH, then retry."}
        </div>
      )}

      <form onSubmit={onSubmit} className="flex shrink-0 items-end gap-2 rounded-2xl bg-[#292929] p-2">
        <textarea
          ref={inputRef}
          rows={2}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder={installed === false ? "Codex CLI unavailable" : "Ask a question…"}
          aria-label="Question for Codex"
          className="max-h-20 min-h-10 min-w-0 flex-1 resize-none bg-transparent p-1 text-xs text-otto-text outline-none placeholder:text-otto-muted"
        />
        {busy ? (
          <button type="button" onClick={() => void stop()} disabled={snapshot.status === "stopping"}
            className="shrink-0 rounded-xl bg-otto-text px-3 py-2 text-xs font-semibold text-otto-surface disabled:opacity-50">Stop</button>
        ) : (
          <button type="submit" disabled={!draft.trim() || installed !== true}
            className="shrink-0 rounded-xl bg-otto-text px-3 py-2 text-xs font-semibold text-otto-surface disabled:opacity-40">Send</button>
        )}
      </form>
      <div className="mt-1 text-center text-[10px] text-otto-muted" aria-live="polite">
        {installed === false ? "Codex not found" : snapshot.status === "idle" ? "Ready to check authentication" : snapshot.status}
      </div>
    </section>
  );
}
