import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { AgentProvider } from "../../../platform/tauri";
import { Icon, Text } from "../../../shared/ui";
import { providerLabel } from "../history/history-model";
import { EngineQuickPopover, type HeaderRuntimeSwitcher } from "./EngineQuickPopover";

export type { HeaderRuntimeSwitcher } from "./EngineQuickPopover";

function runtimeLabel(model: string | null, thinkingEffort: string | null): string {
  if (!model) return "Model not selected";
  return thinkingEffort ? `${model} · ${thinkingEffort}` : model;
}

function useQuickSwitcherEvents(
  open: boolean,
  containerRef: RefObject<HTMLDivElement | null>,
  triggerRef: RefObject<HTMLButtonElement | null>,
  onToggleShortcut: () => void,
  onClose: (restoreFocus: boolean) => void,
) {
  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "m"
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onToggleShortcut();
    };
    document.addEventListener("keydown", onShortcut, true);
    return () => document.removeEventListener("keydown", onShortcut, true);
  }, [onToggleShortcut]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) onClose(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
      triggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, containerRef, triggerRef, onClose]);
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
  const [openedByShortcut, setOpenedByShortcut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const toggleShortcut = useCallback(() => {
    setOpen((current) => {
      const next = !current;
      setOpenedByShortcut(next);
      if (!next) triggerRef.current?.focus({ preventScroll: true });
      return next;
    });
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setOpenedByShortcut(false);
  }, []);

  useQuickSwitcherEvents(open, containerRef, triggerRef, toggleShortcut, close);

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Switch engine or model (Ctrl+M)"
        onClick={() => {
          setOpenedByShortcut(false);
          setOpen((current) => !current);
        }}
        className={`group flex max-w-full min-w-0 flex-col rounded-otto-chip border-0 px-1.5 py-0.5 text-left transition-colors duration-150 focus-visible:outline-1 focus-visible:outline-otto-line-focused ${
          open ? "bg-otto-control/85" : "bg-transparent hover:bg-otto-control/70"
        }`}
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
          autoFocusSearch={openedByShortcut}
          onOpenSettings={() => {
            close();
            switcher.onOpenSettings();
          }}
        />
      )}
    </div>
  );
}
