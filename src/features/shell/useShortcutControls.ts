import { useEffect, useRef, useState } from "react";
import { nativeAvailable, shellShortcut } from "../../platform/tauri/shell-shortcut";

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
          setShortcut(value);
          if (!value) setMessage("Shortcut unavailable. Choose another combination.");
        })
        .catch((error: unknown) => {
          if (active) setMessage(String(error));
        });
    return () => {
      active = false;
    };
  }, []);
  const save = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      setShortcut(await shellShortcut(shortcut));
    } catch (error) {
      setMessage(String(error));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return { shortcut, setShortcut, message, busy, save, available: nativeAvailable };
}
