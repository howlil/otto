import { useEffect, useState } from "react";

export function useTyped(text: string, active: boolean, msPerChar: number): string {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(0);
    if (!active) return;
    const timer = window.setInterval(() => {
      setCount((current) => {
        if (current >= text.length) {
          window.clearInterval(timer);
          return current;
        }
        return current + 1;
      });
    }, msPerChar);
    return () => window.clearInterval(timer);
  }, [text, active, msPerChar]);

  return active ? text.slice(0, count) : "";
}
