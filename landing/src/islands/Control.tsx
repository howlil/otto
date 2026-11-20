import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/arc/button/button";
import { Switch } from "@/components/arc/switch/switch";

type Decision = "none" | "declined" | "allowed";

const messages: Record<Decision, string> = {
  none: "Nothing is approved until you choose.",
  declined: "Declined. The engine gets a graceful denial and can finish the answer in plain text.",
  allowed: "Allowed once. This request only. Otto asks again the next time one comes in.",
};

export default function Control() {
  const [hidden, setHidden] = useState(true);
  const [decision, setDecision] = useState<Decision>("none");

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-3xl border border-otto-line bg-otto-surface p-6 sm:p-8">
        <Switch label="Hide from screen capture" checked={hidden} onCheckedChange={setHidden} />
        <p className="mt-4 leading-relaxed text-otto-muted">
          On by default. This is best effort: some recorders may still capture Otto.
        </p>
      </div>
      <div className="rounded-3xl border border-otto-line bg-otto-surface p-6 sm:p-8">
        <p className="font-display text-lg font-semibold text-otto-text">Host permission request</p>
        <p className="mt-2 leading-relaxed text-otto-muted">
          The engine asks for a host permission decision mid-answer. Otto pauses and waits for your explicit choice.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setDecision("declined")}>
            Decline &amp; continue
          </Button>
          <Button variant="primary" onClick={() => setDecision("allowed")}>
            Allow once
          </Button>
        </div>
        <AnimatePresence mode="wait">
          <motion.p
            key={decision}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="mt-5 text-sm leading-relaxed text-otto-body"
          >
            {messages[decision]}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}
