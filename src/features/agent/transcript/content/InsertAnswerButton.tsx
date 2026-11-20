import { useState } from "react";
import { Icon } from "../../../../shared/ui";

type InsertState = "idle" | "sending" | "sent" | "error";

const markdownFenceLine = /^[\t ]*(?:`{3,}|~{3,})[^\r\n]*(?:\r\n|\n|\r|$)/gm;

export function prepareAnswerForInsertion(value: string): string {
  return value.replace(markdownFenceLine, "");
}

export function InsertAnswerButton({
  value,
  onInsert,
}: {
  value: string;
  onInsert: (value: string) => Promise<void>;
}) {
  const [state, setState] = useState<InsertState>("idle");
  const [error, setError] = useState<string | null>(null);

  const insert = async () => {
    setState("sending");
    setError(null);
    try {
      await onInsert(prepareAnswerForInsertion(value));
      setState("sent");
    } catch (reason) {
      setState("error");
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const label =
    state === "sending"
      ? "Sending"
      : state === "sent"
        ? "Sent"
        : state === "error"
          ? "Retry"
          : "Insert";
  return (
    <>
      <button
        type="button"
        data-insert-state={state}
        disabled={state === "sending"}
        title="Focus an editable field in another app, then insert the answer at its caret."
        onClick={() => void insert()}
        className="inline-flex min-h-7 items-center gap-1.5 border-0 bg-transparent px-0 py-[5px] text-otto-xs text-otto-muted-strong hover:text-otto-text disabled:cursor-wait disabled:opacity-60 motion-safe:transition-[color,transform] motion-safe:duration-150 motion-safe:ease-otto motion-safe:active:scale-[0.97]"
      >
        <Icon
          name={state === "sent" ? "check" : state === "error" ? "unavailable" : "send"}
          size={13}
        />
        {label}
      </button>
      {error && (
        <span className="text-otto-xs text-otto-danger" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
