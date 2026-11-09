import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { nativeAvailable, onNotchFocusChanged } from "../../platform/tauri/shell";
import type { Page } from "./preferences";
import { shouldCollapseOnBlur } from "./surface";

export type SubviewEscapeHandler = (page: Page) => boolean;

export function useShellFocus({
  page,
  expanded,
  mode,
  clickOutside,
  setPage,
  collapse,
  consumeEscape,
}: {
  page: Page;
  expanded: boolean;
  mode: "compact" | "preview" | "pinned";
  clickOutside: boolean;
  setPage: Dispatch<SetStateAction<Page>>;
  collapse: () => void;
  consumeEscape?: SubviewEscapeHandler;
}) {
  const previousPage = useRef<Page>(page);
  const focusPolicy = useRef({ mode, clickOutside });
  focusPolicy.current = { mode, clickOutside };
  const compactButton = useRef<HTMLButtonElement>(null);
  const homeGear = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (
      (previousPage.current === "global-settings" || previousPage.current === "agent-settings") &&
      page === "home"
    ) {
      homeGear.current?.focus({ preventScroll: true });
    }
    previousPage.current = page;
  }, [page]);
  useEffect(() => {
    if (!nativeAvailable) return;
    let unlisten: (() => void) | undefined;
    let active = true;
    void onNotchFocusChanged((focused) => {
      if (
        !focused &&
        shouldCollapseOnBlur(focusPolicy.current.mode, focusPolicy.current.clickOutside)
      ) {
        collapse();
      }
    })
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch(() => {});
    return () => {
      active = false;
      unlisten?.();
    };
  }, [collapse]);

  const handleEscape = useCallback(
    (event: Pick<KeyboardEvent, "key" | "defaultPrevented" | "preventDefault">) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      if (consumeEscape?.(page)) return;
      if (page === "agent-settings") {
        setPage("agent");
        return;
      }
      if (page === "global-settings") {
        setPage("home");
        return;
      }
      collapse();
      requestAnimationFrame(() => compactButton.current?.focus({ preventScroll: true }));
    },
    [collapse, page, setPage, consumeEscape],
  );
  useEffect(() => {
    if (!expanded) return;
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [expanded, handleEscape]);

  return { compactButton, homeGear, handleEscape };
}
