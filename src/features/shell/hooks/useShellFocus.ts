import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { onNotchFocusChanged } from "../../../platform/tauri/shell";
import { nativeAvailable } from "../../../platform/tauri/runtime";
import type { Page } from "../model/preferences";
import { shouldCollapseOnBlur } from "../model/surface";

export function useShellFocus({
  page,
  expanded,
  mode,
  clickOutside,
  setPage,
  collapse,
  dismiss,
}: {
  page: Page;
  expanded: boolean;
  mode: "compact" | "preview" | "pinned";
  clickOutside: boolean;
  setPage: Dispatch<SetStateAction<Page>>;
  collapse: () => void;
  dismiss: () => void;
}) {
  const previousPage = useRef<Page>(page);
  const focusPolicy = useRef({ mode, clickOutside });
  focusPolicy.current = { mode, clickOutside };
  const compactButton = useRef<HTMLButtonElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (previousPage.current === "settings" && page === "agent") {
      settingsButton.current?.focus({ preventScroll: true });
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
      if (page === "settings") {
        setPage("agent");
        return;
      }
      dismiss();
      requestAnimationFrame(() => compactButton.current?.focus({ preventScroll: true }));
    },
    [dismiss, page, setPage],
  );
  useEffect(() => {
    if (!expanded) return;
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [expanded, handleEscape]);

  return { compactButton, settingsButton, handleEscape };
}
