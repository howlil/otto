import { useState } from "react";
import { CircleMark, circleStates } from "@/components/otto/Mark";

const order = ["idle", "capturing", "streaming", "listening", "speaking", "completed", "error"] as const;

type Key = (typeof order)[number];

const captions: Record<Key, string> = {
  idle: "Resting. Click Otto to open it.",
  capturing: "Snipping the part of the screen you asked for.",
  streaming: "Answering. The ring orbits while the answer streams.",
  listening: "Listening for your voice with Ctrl Alt V.",
  speaking: "Reading the answer aloud, eyes moving with the voice.",
  completed: "Answer ready. The ring settles and the eyes smile.",
  error: "Something needs attention. Open Otto to see why.",
};

export default function CircleStates() {
  const [active, setActive] = useState<Key>("idle");
  const [wave, setWave] = useState(0);

  const choose = (key: Key) => {
    setActive(key);
    setWave((count) => count + 1);
  };

  return (
    <div>
      <div role="radiogroup" aria-label="Circle states" className="flex flex-wrap items-start justify-center gap-x-6 gap-y-8 sm:gap-x-9">
        {order.map((key) => {
          const selected = active === key;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => choose(key)}
              className="group flex w-[72px] flex-col items-center gap-3 bg-transparent"
            >
              <span
                className={`rounded-full p-1 transition-colors duration-150 ${selected ? "bg-otto-control" : "group-hover:bg-otto-control/60"}`}
              >
                <CircleMark state={circleStates[key]} waveKey={selected ? wave : 0} />
              </span>
              <span className={`text-otto-xs transition-colors duration-150 ${selected ? "text-otto-text" : "text-otto-text-tertiary"}`}>
                {circleStates[key].label}
              </span>
            </button>
          );
        })}
      </div>
      <p aria-live="polite" className="mx-auto mt-10 max-w-md text-center text-otto-md leading-[1.6] text-otto-text-secondary">
        {captions[active]}
      </p>
    </div>
  );
}
