import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

type PopoverFitContextValue = {
  panelRef: RefObject<HTMLElement | null>;
  report: (id: string, minCardHeight: number | null) => void;
};

const PopoverFitContext = createContext<PopoverFitContextValue | null>(null);

export function AgentPopoverFitProvider({
  panelRef,
  onOverlayHeightChange,
  children,
}: {
  panelRef: RefObject<HTMLElement | null>;
  onOverlayHeightChange: (height: number) => void;
  children: ReactNode;
}) {
  const heightsRef = useRef(new Map<string, number>());
  const lastMaxRef = useRef(0);

  const report = useCallback(
    (id: string, minCardHeight: number | null) => {
      if (minCardHeight === null || minCardHeight <= 0) {
        heightsRef.current.delete(id);
      } else {
        heightsRef.current.set(id, Math.ceil(minCardHeight));
      }
      let nextMax = 0;
      for (const value of heightsRef.current.values()) {
        if (value > nextMax) nextMax = value;
      }
      if (nextMax !== lastMaxRef.current) {
        lastMaxRef.current = nextMax;
        onOverlayHeightChange(nextMax);
      }
    },
    [onOverlayHeightChange],
  );

  const value = useMemo(() => ({ panelRef, report }), [panelRef, report]);
  return <PopoverFitContext.Provider value={value}>{children}</PopoverFitContext.Provider>;
}

function resolveReserve(
  anchor: "top" | "bottom",
  panelRect: DOMRect,
  triggerRect: DOMRect | undefined,
): number {
  const edgeGap = 12;
  if (anchor === "top") {
    const offset = triggerRect ? Math.ceil(triggerRect.bottom - panelRect.top + 8) : 56;
    return Math.max(56, offset) + edgeGap;
  }
  const offset = triggerRect ? Math.ceil(panelRect.bottom - triggerRect.top + 10) : 66;
  return Math.max(66, offset) + edgeGap;
}

export function usePopoverFit(
  open: boolean,
  anchor: "top" | "bottom",
  popoverRef: RefObject<HTMLElement | null>,
): number | undefined {
  const context = useContext(PopoverFitContext);
  const id = useId();
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    if (!open) {
      context?.report(id, null);
      setMaxHeight(undefined);
      return;
    }
    const el = popoverRef.current;
    if (!el) return;
    const panel =
      context?.panelRef.current ?? el.closest<HTMLElement>('[data-surface="agent"]') ?? null;

    const update = () => {
      const node = popoverRef.current;
      if (!node) return;
      const contentHeight = Math.ceil(node.scrollHeight + 2);
      if (!panel) {
        context?.report(id, contentHeight + 80);
        return;
      }
      const panelRect = panel.getBoundingClientRect();
      const triggerRect = node.parentElement?.getBoundingClientRect();
      const reserve = resolveReserve(anchor, panelRect, triggerRect);
      context?.report(id, contentHeight + reserve);
      if (panelRect.height > 0) {
        const available = Math.max(120, Math.floor(panelRect.height - reserve));
        setMaxHeight((current) => (current === available ? current : available));
      }
    };

    update();
    if (typeof ResizeObserver === "undefined") {
      return () => context?.report(id, null);
    }
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (panel) observer.observe(panel);
    return () => {
      observer.disconnect();
      context?.report(id, null);
    };
  }, [open, anchor, popoverRef, context, id]);

  return maxHeight;
}

export function usePanelMeasuredHeight(historyOpen: boolean, onMeasured: (height: number) => void) {
  const historyOpenRef = useRef(historyOpen);
  historyOpenRef.current = historyOpen;
  const contentHeightRef = useRef(0);
  const overlayHeightRef = useRef(0);

  const emit = useCallback(() => {
    if (historyOpenRef.current) return;
    if (contentHeightRef.current <= 0 && overlayHeightRef.current <= 0) return;
    onMeasured(Math.max(contentHeightRef.current, overlayHeightRef.current));
  }, [onMeasured]);

  const onContentMeasured = useCallback(
    (height: number) => {
      contentHeightRef.current = height;
      emit();
    },
    [emit],
  );

  const onOverlayHeightChange = useCallback(
    (height: number) => {
      overlayHeightRef.current = height;
      emit();
    },
    [emit],
  );

  useEffect(() => {
    if (historyOpen) overlayHeightRef.current = 0;
  }, [historyOpen]);

  return { onContentMeasured, onOverlayHeightChange };
}
