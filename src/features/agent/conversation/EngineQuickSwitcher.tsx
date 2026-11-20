import { useEffect, useRef, useState } from "react";
import type { AgentProvider } from "../../../platform/tauri";
import { Icon, Text } from "../../../shared/ui";
import { providerLabel } from "../history/history-model";
import { EngineQuickPopover, type HeaderRuntimeSwitcher } from "./EngineQuickPopover";

export type { HeaderRuntimeSwitcher } from "./EngineQuickPopover";

function runtimeLabel(model: string | null, thinkingEffort: string | null): string {
  if (!model) return "Model not selected";
  return thinkingEffort ? `${model} · ${thinkingEffort}` : model;
}

export function EngineQuickSwitcher({
  provider,
  model,
  thinkingEffort,
  switcher,
}: {
  provider: AgentProvider;
  model: string | null;
  thinkingEffort: string | null;
  switcher: HeaderRuntimeSwitcher;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
        className="group flex max-w-full min-w-0 flex-col rounded-otto-chip border-0 bg-transparent px-1.5 py-0.5 text-left transition-colors duration-150 hover:bg-otto-control/70 focus-visible:outline-1 focus-visible:outline-otto-line-focused"
      >
        <span className="flex min-w-0 items-center gap-1">
          <Text
            as="strong"
            variant="title"
            className="block overflow-hidden text-ellipsis whitespace-nowrap"
          >
            {providerLabel(provider)}
          </Text>
          <Icon
            name="chevronDown"
            size={12}
            className={`shrink-0 text-otto-text-tertiary transition-transform duration-150 group-hover:text-otto-text-secondary ${open ? "rotate-180" : ""}`}
          />
        </span>
        <Text
          as="small"
          variant="meta"
          className="mt-0.5 block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-otto-text-tertiary"
        >
          {runtimeLabel(model, thinkingEffort)}
        </Text>
      </button>
      {open && (
        <EngineQuickPopover
          provider={provider}
          model={model}
          thinkingEffort={thinkingEffort}
          switcher={switcher}
          onOpenSettings={() => {
            setOpen(false);
            switcher.onOpenSettings();
          }}
        />
      )}
    </div>
  );
}
