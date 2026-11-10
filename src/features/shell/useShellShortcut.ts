import { useEffect, useRef } from "react";
import { onShellToggle } from "../../platform/tauri/shell-shortcut";

export function useShellShortcut(toggle: () => void) {
  const latest = useRef(toggle);
  latest.current = toggle;
  useEffect(() => {
    let active = true;
    let stop: (() => void) | undefined;
    void onShellToggle(() => {
      if (active) latest.current();
    })
      .then((unsubscribe) => {
        if (active) stop = unsubscribe;
        else unsubscribe();
      })
      .catch(() => {});
    return () => {
      active = false;
      stop?.();
    };
  }, []);
}
