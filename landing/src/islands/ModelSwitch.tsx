import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

const engines = ["Codex", "Claude Code", "Gemini CLI", "OpenCode"];
const efforts = ["Low", "Medium", "High"];

export default function ModelSwitch() {
  const [open, setOpen] = useState(true);
  const [engine, setEngine] = useState(0);
  const [effort, setEffort] = useState(1);
  const [auto, setAuto] = useState(true);

  useEffect(() => {
    if (!auto) return;
    const timer = window.setInterval(() => setEngine((current) => (current + 1) % engines.length), 2200);
    return () => window.clearInterval(timer);
  }, [auto]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== "m") return;
      event.preventDefault();
      setOpen((current) => !current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pickEngine = (index: number) => {
    setAuto(false);
    setEngine(index);
  };

  return (
    <div className="mx-auto w-full max-w-[336px]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between rounded-otto-card border border-otto-line bg-otto-surface px-3.5 py-3 text-left"
      >
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-1 text-otto-md font-[590] text-otto-text">
            {engines[engine]}
            <ChevronDown size={12} strokeWidth={1.8} className="text-otto-text-tertiary" />
          </span>
          <span className="mt-1 text-otto-xs text-otto-text-tertiary">Default model · {efforts[effort].toLowerCase()}</span>
        </span>
        <span className="rounded-otto-chip border border-otto-line-mid bg-otto-raised-soft px-1.5 py-0.5 font-mono text-otto-2xs text-otto-text-secondary">
          Ctrl M
        </span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-3 rounded-otto-card border border-otto-line-strong bg-otto-surface p-3 shadow-lg">
          <div>
            <p className="mb-1.5 text-otto-xs text-otto-text-secondary">AI Engine</p>
            <div className="flex flex-wrap gap-1.5">
              {engines.map((name, index) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => pickEngine(index)}
                  className={`rounded-full border px-2.5 py-1 text-otto-xs transition-colors duration-150 ${index === engine ? "border-otto-line-strong bg-otto-selected text-otto-text" : "border-otto-line-soft bg-otto-control text-otto-text-secondary hover:bg-otto-control-hover"}`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-otto-xs text-otto-text-secondary">Thinking effort</p>
            <div className="grid grid-cols-3 gap-0.5 rounded-otto-control bg-otto-control-deep p-0.5">
              {efforts.map((name, index) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setEffort(index)}
                  className={`rounded-[7px] py-1.5 text-otto-xs transition-colors duration-150 ${index === effort ? "bg-otto-selected text-otto-text" : "text-otto-text-tertiary hover:text-otto-text-secondary"}`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end border-t border-otto-line-soft pt-2">
            <span className="text-otto-xs text-otto-text-tertiary">All engines &amp; profile</span>
          </div>
        </div>
      )}
    </div>
  );
}
