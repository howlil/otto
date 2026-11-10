import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type WheelEvent,
} from "react";
import { adjacentModule, ModuleGesture, ownsHorizontalInput } from "./module-gesture";
import type { Page } from "./preferences";

export function useModuleNavigation(
  page: Page,
  navigate: (page: Page) => void,
  clearTimers: () => void = () => {},
  enabled = true,
) {
  const gesture = useRef(new ModuleGesture());
  const currentPage = useRef(page);
  currentPage.current = page;
  const [moduleDirection, setModuleDirection] = useState<"forward" | "back">("forward");
  useEffect(() => {
    if (!enabled) gesture.current.reset();
  }, [enabled]);
  const move = useCallback(
    (direction: number) => {
      const next = adjacentModule(currentPage.current, direction);
      if (next) {
        currentPage.current = next;
        setModuleDirection(direction > 0 ? "forward" : "back");
        clearTimers();
        navigate(next);
      }
    },
    [navigate, clearTimers],
  );
  const onModuleWheel = useCallback(
    (event: WheelEvent) => {
      if (
        !enabled ||
        event.ctrlKey ||
        ownsHorizontalInput(event.target) ||
        event.currentTarget.querySelector('[role="dialog"]') ||
        page.endsWith("settings")
      ) {
        gesture.current.reset();
        return;
      }
      const direction = gesture.current.feed(
        event.deltaX,
        event.deltaY,
        event.deltaMode,
        performance.now(),
      );
      if (direction) move(direction);
    },
    [move, page, enabled],
  );
  const onModuleKey = useCallback(
    (event: KeyboardEvent) => {
      if (
        !enabled ||
        event.currentTarget.querySelector('[role="dialog"]') ||
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        ownsHorizontalInput(event.target)
      )
        return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (page.endsWith("settings")) return;
      event.preventDefault();
      move(event.key === "ArrowRight" ? 1 : -1);
    },
    [move, page, enabled],
  );
  return { onModuleWheel, onModuleKey, moduleDirection };
}
