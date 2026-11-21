import { Icon, VisuallyHidden } from "../../shared/ui";

export function ListenAnswerButton({
  speaking,
  onToggle,
}: {
  speaking: boolean;
  onToggle: () => void;
}) {
  const label = speaking ? "Stop reading" : "Listen";
  return (
    <button
      type="button"
      data-speaking={speaking ? "true" : "false"}
      onClick={onToggle}
      title={speaking ? "Stop reading answer aloud" : "Read answer aloud"}
      className={`inline-flex min-h-7 items-center gap-1.5 border-0 bg-transparent px-0 py-[5px] text-otto-xs motion-safe:transition-[color,transform] motion-safe:duration-150 motion-safe:ease-otto motion-safe:active:scale-[0.97] ${
        speaking
          ? "text-otto-ok hover:text-otto-text"
          : "text-otto-muted-strong hover:text-otto-text"
      }`}
    >
      <Icon name={speaking ? "volumeOff" : "volume"} size={13} />
      <span aria-hidden="true">{speaking ? "Stop" : "Listen"}</span>
      <VisuallyHidden>{label}</VisuallyHidden>
    </button>
  );
}
