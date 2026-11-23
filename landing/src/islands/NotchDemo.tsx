import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { demo } from "@/data/otto";
import { Capsule, Composer, PanelHeader } from "@/components/otto/Notch";
import type { Expression } from "@/components/otto/Mark";
import { AnswerText, TurnActions, UserBubble } from "@/components/otto/Transcript";
import { useTyped } from "@/components/otto/useTyped";

type Phase = "compact" | "snip" | "compose" | "send" | "answer" | "done";

const next: Partial<Record<Phase, { wait: number; to: Phase }>> = {
  compact: { wait: 1000, to: "snip" },
  snip: { wait: 900, to: "compose" },
  compose: { wait: 1600, to: "send" },
  send: { wait: 300, to: "answer" },
  answer: { wait: 2400, to: "done" },
};

const spring = { type: "spring", stiffness: 438.6, damping: 35.2 } as const;

export default function NotchDemo() {
  const reduced = Boolean(useReducedMotion());
  const [phase, setPhase] = useState<Phase>("compact");
  const [open, setOpen] = useState(true);
  const question = useTyped(demo.question, phase === "compose", 32);
  const streamed = useTyped(demo.answer, phase === "answer", 15);

  useEffect(() => {
    if (reduced) {
      setPhase("done");
      return;
    }
    const step = next[phase];
    if (!step) return;
    const timer = window.setTimeout(() => setPhase(step.to), step.wait);
    return () => window.clearTimeout(timer);
  }, [phase, reduced]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.altKey || event.shiftKey || event.key.toLowerCase() !== "o") return;
      event.preventDefault();
      setOpen((current) => !current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const expanded = open && phase !== "compact" && phase !== "snip";
  const busy = phase === "snip" || phase === "send" || phase === "answer";
  const done = phase === "done";
  const answer = done ? demo.answer : streamed;
  const expression: Expression =
    phase === "send" || phase === "answer" ? "working" : done ? "completed" : "idle";

  return (
    <div aria-hidden="true" className="relative flex w-full flex-col items-center">
      <motion.div
        initial={false}
        animate={{
          width: expanded ? 526 : 228,
          height: expanded ? "auto" : 40,
          borderRadius: expanded ? 18 : 999,
        }}
        transition={reduced ? { duration: 0 } : spring}
        style={{ maxWidth: "100%" }}
        className="relative z-10 overflow-hidden border border-otto-line bg-otto-surface"
      >
        {expanded ? (
          <div className="flex w-full flex-col">
            <PanelHeader
              label="Codex"
              detail="Ready"
              expression={expression}
              expressive={expression !== "idle"}
              onSwitch={() => setOpen(false)}
            />
            <div className="flex min-h-[64px] flex-col gap-3 px-[18px] pb-3">
              {(phase === "send" || phase === "answer" || done) && (
                <UserBubble>{demo.question}</UserBubble>
              )}
              {(phase === "answer" || done) && (
                <div className="flex flex-col">
                  <AnswerText caret={phase === "answer"}>{answer}</AnswerText>
                  {done && <TurnActions chips={demo.followUps.map((item) => item.label)} />}
                </div>
              )}
            </div>
            <Composer
              placeholder={phase === "compose" ? "Add a question or press Enter to explain…" : "Ask Otto anything…"}
              text={phase === "compose" ? question : ""}
              caret={phase === "compose"}
              mode="Direct"
              expanded={phase === "compose"}
              staged={phase === "compose" ? demo.context : null}
              actions={phase === "compose" ? ["Explain", "Solve", "Quiz me"] : []}
              busy={busy}
              ready={phase === "compose" && question.length === demo.question.length}
            />
          </div>
        ) : (
          <Capsule
            label="Codex"
            detail={busy ? "Codex · Working" : "Codex · Ready"}
            busy={busy}
            onClick={() => setOpen(true)}
          />
        )}
      </motion.div>
    </div>
  );
}
