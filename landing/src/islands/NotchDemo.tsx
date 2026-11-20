import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronUp } from "lucide-react";
import { Button } from "@/components/arc/button/button";
import { CopyButton } from "@/components/arc/copy-button/copy-button";
import { motionTokens } from "@/components/arc/motion-tokens";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { demo } from "@/data/otto";

export default function NotchDemo() {
  const reduced = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const [answer, setAnswer] = useState<string>(demo.answer);
  const [followUp, setFollowUp] = useState("");
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(true);
  const [inserted, setInserted] = useState(false);

  useEffect(() => {
    const open = window.setTimeout(() => setExpanded(true), 500);
    const toggle = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        setExpanded((value) => !value);
      }
    };
    window.addEventListener("keydown", toggle);
    return () => {
      window.clearTimeout(open);
      window.removeEventListener("keydown", toggle);
    };
  }, []);

  useEffect(() => {
    if (reduced) {
      setCount(answer.length);
      setBusy(false);
      return;
    }
    let typed = 0;
    let timer = 0;
    setCount(0);
    setBusy(true);
    const start = window.setTimeout(() => {
      timer = window.setInterval(() => {
        typed = Math.min(answer.length, typed + 2);
        setCount(typed);
        if (typed === answer.length) {
          window.clearInterval(timer);
          setBusy(false);
        }
      }, 22);
    }, 900);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(timer);
    };
  }, [answer, reduced]);

  useEffect(() => {
    if (!inserted) return;
    const reset = window.setTimeout(() => setInserted(false), 1600);
    return () => window.clearTimeout(reset);
  }, [inserted]);

  const pick = (label: string, text: string) => {
    setFollowUp(label);
    setAnswer(text);
  };

  const streamed = answer.slice(0, count);
  const thinking = busy && count === 0;
  const morph = reduced ? { duration: 0 } : motionTokens.spring.morph;

  return (
    <div className="relative h-[480px] w-full overflow-hidden rounded-[28px] border border-otto-line bg-otto-surface sm:h-[500px]">
      <div aria-hidden="true" className="grid-fade absolute inset-0 p-8 pt-24 sm:p-10 sm:pt-28">
        <div className="h-3 w-2/5 rounded-full bg-white/15" />
        <div className="mt-6 space-y-3">
          {[92, 100, 84, 100, 76, 96, 64].map((width, index) => (
            <div key={`line-${index}`} className="h-2 rounded-full bg-white/[0.07]" style={{ width: `${width}%` }} />
          ))}
        </div>
        <div className="mt-6 rounded-lg bg-otto-lavender/15 px-4 py-3 font-mono text-xs text-otto-lavender">
          f′(x) = lim (f(x + h) − f(x)) / h
        </div>
        <div className="mt-6 space-y-3">
          {[88, 100, 70].map((width, index) => (
            <div key={`tail-${index}`} className="h-2 rounded-full bg-white/[0.07]" style={{ width: `${width}%` }} />
          ))}
        </div>
      </div>

      <div className="absolute inset-x-0 top-3 flex justify-center px-3">
        <motion.div
          layout
          transition={morph}
          className={`overflow-hidden rounded-[20px] border border-white/15 bg-black shadow-[0_24px_60px_-12px_rgb(0_0_0_/_0.6)] ${expanded ? "w-[min(526px,100%)]" : "w-[228px]"}`}
        >
          <AnimatePresence mode="wait" initial={false}>
            {expanded ? (
              <motion.div
                key="expanded"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="flex flex-col gap-4 p-4 text-left"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-[13px] text-otto-text">
                    <img src="/otto-icon.png" alt="" width="20" height="20" className="size-5 rounded-full" />
                    Simple
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-otto-muted">/simple</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpanded(false)}
                    className="grid size-7 place-items-center rounded-full text-otto-muted transition hover:bg-white/10 hover:text-otto-text"
                  >
                    <ChevronUp size={16} aria-hidden="true" />
                    <span className="sr-only">Collapse Otto</span>
                  </button>
                </div>

                <div className="space-y-2">
                  <span className="inline-flex rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-otto-muted">
                    {demo.context}
                  </span>
                  <p className="text-sm text-otto-body">{followUp ? `Follow-up: ${followUp}` : demo.question}</p>
                </div>

                <div className="min-h-[96px] text-[14px] leading-relaxed text-otto-text">
                  {thinking ? (
                    <TextShimmer>Reading context</TextShimmer>
                  ) : (
                    <p>
                      {streamed}
                      {busy ? <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-[3px] bg-otto-text" /> : null}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {demo.followUps.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        disabled={busy}
                        aria-pressed={followUp === item.label}
                        onClick={() => pick(item.label, item.answer)}
                        className="rounded-full border border-white/15 px-2.5 py-1 text-[12px] text-otto-body transition hover:border-white/35 hover:text-otto-text disabled:opacity-40"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <CopyButton value={answer} label="Copy" variant="plain" disabled={busy} />
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => setInserted(true)}>
                      {inserted ? "Inserted" : "Insert"}
                    </Button>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.button
                key="compact"
                type="button"
                onClick={() => setExpanded(true)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="flex h-10 w-full items-center gap-2 px-3 text-left text-[13px] text-otto-muted"
              >
                <img src="/otto-icon.png" alt="" width="20" height="20" className="size-5 rounded-full" />
                <span className="flex-1 truncate">Ask Otto anything…</span>
                <kbd className="rounded-md border border-white/15 px-1.5 py-0.5 font-mono text-[11px] text-otto-body">Ctrl Alt O</kbd>
              </motion.button>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      <p className="absolute inset-x-0 bottom-3 text-center text-xs text-otto-muted">Illustrative preview of the notch</p>
    </div>
  );
}
