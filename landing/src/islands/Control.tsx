import { useState } from "react";
import { PermissionCard } from "@/components/otto/Transcript";

export default function Control() {
  const [hidden, setHidden] = useState(true);
  const [result, setResult] = useState("");

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="rounded-otto-card border border-otto-line bg-otto-surface p-5 sm:p-6">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-otto-md font-[590] text-otto-text">Hide from screen capture</p>
            <p className="mt-1 text-otto-xs leading-[1.5] text-otto-text-tertiary">
              Best effort. Some recorders may still see Otto.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={hidden}
            aria-label="Hide from screen capture"
            onClick={() => setHidden((current) => !current)}
            className={`relative h-6 w-10 flex-none rounded-full transition-colors duration-150 ${hidden ? "bg-otto-switch-enabled" : "bg-otto-switch-track"}`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-otto-knob transition-transform duration-150 ${hidden ? "translate-x-[18px]" : "translate-x-0.5"}`}
            />
          </button>
        </div>
      </div>
      <div className="rounded-otto-card border border-otto-line bg-otto-surface p-5 sm:p-6">
        <PermissionCard
          engine="Gemini CLI"
          title="Read notes.md from your Documents folder"
          onDecline={() => setResult("Declined. The answer continues without that step.")}
          onAllow={() => setResult("Allowed once. The next request asks again.")}
        />
        <p aria-live="polite" className="mt-3 min-h-[1.25rem] text-otto-xs text-otto-text-tertiary">
          {result}
        </p>
      </div>
    </div>
  );
}
