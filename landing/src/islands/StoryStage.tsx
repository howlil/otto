import { useRef, useState } from "react";
import { motion, useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";
import { modes } from "@/data/otto";
import { Capsule, Composer, ModeMenu, PanelHeader } from "@/components/otto/Notch";
import { CircleMark, circleStates, type Expression } from "@/components/otto/Mark";
import { AnswerText, TurnActions, UserBubble } from "@/components/otto/Transcript";

const acts = [
  "Always one shortcut away.",
  "Snip a region, then pick what to do with it.",
  "Switch how Otto teaches, without leaving the prompt.",
  "Speak instead of typing.",
  "Hear the answer read aloud.",
  "Insert it into the page you are working on.",
];

const question = "Why does ice float?";
const answer = modes[0].answer;
const spring = { type: "spring", stiffness: 438.6, damping: 35.2 } as const;

type NotchView = "capsule" | "panel" | "circle";

function slice(text: string, ratio: number): string {
  return text.slice(0, Math.round(text.length * Math.min(1, Math.max(0, ratio))));
}

export default function StoryStage() {
  const reduced = Boolean(useReducedMotion());
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [progress, setProgress] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (value) => setProgress(value));

  const scaled = Math.min(0.9999, Math.max(0, progress)) * acts.length;
  const act = Math.floor(scaled);
  const local = scaled - act;

  const view: NotchView = act === 4 && local >= 0.7 ? "circle" : act === 0 || act === 5 ? "capsule" : "panel";
  const menuIndex = Math.min(modes.length - 1, Math.floor(local * modes.length));
  const headerExpression: Expression = act === 3 ? "listening" : act === 4 ? "speaking" : "idle";
  const size =
    view === "capsule"
      ? { width: 228, height: 40, borderRadius: 999 }
      : view === "circle"
        ? { width: 40, height: 40, borderRadius: 999 }
        : { width: 526, height: "auto", borderRadius: 18 };
  const shell = view === "circle" ? "border-transparent bg-transparent" : "border-otto-line bg-otto-surface";

  return (
    <div ref={ref} className="relative h-[480svh]">
      <div className="sticky top-0 flex h-svh flex-col items-center justify-center px-4">
        <div className="relative h-[min(520px,calc(100svh-10rem))] w-full max-w-4xl overflow-hidden rounded-[28px] border border-otto-line bg-otto-surface">
          <div aria-hidden="true" className="grid-fade absolute inset-0" />
          <div
            aria-hidden="true"
            className="absolute inset-x-5 bottom-5 top-[150px] overflow-hidden rounded-otto-card border border-otto-line-soft bg-otto-bg p-5"
          >
            <div className="h-2.5 w-1/3 rounded-full bg-otto-raised-soft" />
            <div className="mt-4 space-y-2.5">
              {[92, 84, 88].map((width) => (
                <div key={width} className="h-2 rounded-full bg-otto-raised-soft" style={{ width: `${width}%` }} />
              ))}
            </div>
            <div className="mt-6 min-h-[64px] text-otto-md leading-[1.6] text-otto-text-soft-white">
              {act === 5 && slice(answer, (local - 0.1) / 0.9)}
              {act === 5 && <span className="otto-caret ml-px inline-block h-[14px] w-[1.5px] translate-y-[2px] bg-otto-text" />}
            </div>
            <div className="mt-2 space-y-2.5">
              {[78, 64].map((width) => (
                <div key={width} className="h-2 rounded-full bg-otto-raised-soft" style={{ width: `${width}%` }} />
              ))}
            </div>
            {act === 1 && (
              <div
                className="absolute left-[8%] top-[46%] rounded-[6px] border border-dashed border-otto-text/80 bg-white/[0.04]"
                style={{
                  width: `${Math.min(1, local * 1.4) * 46}%`,
                  height: `${Math.min(1, local * 1.4) * 30}%`,
                }}
              />
            )}
            {act === 5 && local > 0.1 && (
              <span className="absolute bottom-3 right-3 rounded-full border border-otto-line bg-otto-surface px-2.5 py-1 text-otto-2xs leading-[1.2] text-otto-text-secondary">
                Typed in · clipboard untouched
              </span>
            )}
          </div>
          <motion.div
            initial={false}
            animate={size}
            transition={reduced ? { duration: 0 } : spring}
            style={{ maxWidth: "calc(100% - 2rem)" }}
            className={`absolute left-1/2 top-5 z-10 -translate-x-1/2 overflow-hidden border ${shell}`}
          >
            {view === "capsule" && <Capsule label={act === 5 ? "Answer ready" : "Codex"} detail="Codex · Ready" />}
            {view === "circle" && <CircleMark state={circleStates.speaking} />}
            {view === "panel" && (
              <div className="flex w-full flex-col">
                <PanelHeader
                  label="Codex"
                  detail={act === 3 ? "Listening" : act === 4 ? "Reading aloud" : "Ready"}
                  expression={headerExpression}
                  expressive={act === 3 || act === 4}
                />
                <div className={`flex flex-col gap-3 px-[18px] pb-3 ${act === 2 ? "min-h-[240px]" : "min-h-[40px]"}`}>
                  {act === 4 && <UserBubble>{question}</UserBubble>}
                  {act === 4 && (
                    <div className="flex flex-col">
                      <AnswerText>{answer}</AnswerText>
                      <TurnActions speaking={local >= 0.35} />
                    </div>
                  )}
                </div>
                {act === 1 ? (
                  <Composer
                    placeholder="Add a question or press Enter to explain…"
                    mode="Direct"
                    expanded
                    staged="Region snip · 1 image"
                    actions={["Solve", "Explain", "Break down"]}
                    ready
                  />
                ) : act === 2 ? (
                  <Composer
                    text="/"
                    placeholder="Type / to switch the way Otto teaches"
                    mode={modes[menuIndex].name}
                    menu={<ModeMenu items={modes} active={menuIndex} />}
                  />
                ) : act === 3 ? (
                  <Composer
                    text={slice(question, (local - 0.35) / 0.55)}
                    placeholder="Ask Otto anything…"
                    mode="Direct"
                    listening
                    caret
                  />
                ) : (
                  <Composer placeholder="Ask Otto anything…" mode="Direct" ready={act === 4} />
                )}
              </div>
            )}
          </motion.div>
        </div>
        <div className="mt-5 flex w-full max-w-4xl items-center justify-between gap-6">
          <p className="text-otto-md font-[590] text-otto-text">{acts[act]}</p>
          <div aria-hidden="true" className="flex flex-none items-center gap-1.5">
            {acts.map((title, index) => (
              <span
                key={title}
                className={`h-1.5 rounded-full transition-[width,background-color] duration-300 ${index === act ? "w-5 bg-otto-text" : "w-1.5 bg-otto-line-mid"}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
