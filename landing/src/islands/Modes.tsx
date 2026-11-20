import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { modes } from "@/data/otto";

const question = "Why does ice float?";

export default function Modes() {
  const [name, setName] = useState(modes[0].name);
  const active = modes.find((mode) => mode.name === name) ?? modes[0];

  return (
    <div className="rounded-3xl border border-otto-line bg-otto-surface p-5 sm:p-8">
      <SegmentedControl
        label="Learning mode"
        options={modes.map((mode) => ({ value: mode.name, label: mode.name }))}
        value={name}
        onValueChange={setName}
        fullWidth
      />
      <div className="mt-8 grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div>
          <p className="font-mono text-sm text-otto-muted">{active.slash}</p>
          <p className="mt-3 font-display text-2xl leading-snug tracking-tight text-otto-text">{active.summary}</p>
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={active.name}
            initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -8, filter: "blur(6px)" }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-2xl border border-otto-line bg-otto-bg p-5 sm:p-6"
          >
            <p className="mb-3 text-sm text-otto-muted">You: {question}</p>
            <p className="leading-relaxed text-otto-body">{active.answer}</p>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
