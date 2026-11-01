import { useCallback, useEffect, useLayoutEffect, useRef, type UIEvent } from "react";

type TranscriptViewportOptions = {
  onMeasured: (height: number) => void;
  searchOpen: boolean;
  exportError: boolean;
  captureActionError: string | null;
  seq: number;
  activeMatch: number | null;
};

export function useTranscriptViewport({
  onMeasured,
  searchOpen,
  exportError,
  captureActionError,
  seq,
  activeMatch,
}: TranscriptViewportOptions) {
  const feed = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const measure = useCallback(() => {
    const stack = feed.current?.firstElementChild;
    const composerHeight = composer.current?.offsetHeight;
    if (!stack || composerHeight === undefined) return;
    const accessoryHeight = (searchOpen || exportError ? 40 : 0) + (captureActionError ? 24 : 0);
    onMeasured(53 + stack.scrollHeight + 16 + composerHeight + accessoryHeight);
  }, [onMeasured, searchOpen, exportError, captureActionError]);

  useLayoutEffect(() => {
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    const stack = feed.current?.firstElementChild;
    if (stack) observer.observe(stack);
    if (composer.current) observer.observe(composer.current);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    if (seq > 0 && nearBottom.current && !searchOpen) {
      feed.current?.scrollTo({ top: feed.current.scrollHeight });
    }
  }, [seq, searchOpen]);

  useEffect(() => {
    if (activeMatch === null) return;
    const rows = feed.current?.querySelectorAll("[data-conversation-message]");
    rows?.[activeMatch]?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [activeMatch]);

  const onFeedScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }, []);

  return { feed, composer, onFeedScroll };
}
