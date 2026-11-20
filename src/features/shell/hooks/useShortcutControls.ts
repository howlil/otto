import { useEffect, useRef, useState } from "react";
import { shellShortcut } from "../../../platform/tauri/shell-shortcut";
import { nativeAvailable } from "../../../platform/tauri/runtime";

export function useShortcutControls() {
  const [shortcut, setShortcut] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    if (nativeAvailable)
      void shellShortcut()
        .then((value) => {
          if (!active) return;
          const next = typeof value === "string" ? value : "";
          setShortcut(next);
          if (!next) setMessage("Shortcut unavailable. Choose another combination.");
        })
        .catch((error: unknown) => {
          if (active) setMessage(String(error));
        });
    return () => {
      active = false;
    };
  }, []);
  const save = async (next?: string) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      const saved = await shellShortcut(next ?? shortcut);
      setShortcut(typeof saved === "string" ? saved : "");
    } catch (error) {
      setMessage(String(error));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return { shortcut, setShortcut, message, busy, save, available: nativeAvailable };
}
