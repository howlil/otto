import { CopyButton } from "@/components/arc/copy-button/copy-button";

export default function CopyCommand({ command }: { command: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-otto-line bg-otto-bg px-3 py-2">
      <code className="truncate font-mono text-[13px] text-otto-body">{command}</code>
      <CopyButton value={command} label="Copy" variant="outline" />
    </div>
  );
}
