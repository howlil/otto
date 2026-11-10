import { useCallback, useEffect, useLayoutEffect, useRef, type UIEvent } from "react";
import { useTransitionActive } from "../../shared/ui";

type TranscriptViewportOptions = {
  onMeasured: (height: number) => void;
  captureActionError: string | null;
  seq: number;
};

export function useTranscriptViewport({
  onMeasured,
  captureActionError,
  seq,
}: TranscriptViewportOptions) {
  const active = useTransitionActive();
  const feed = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const measure = useCallback(() => {
    const stack = feed.current?.firstElementChild;
    const composerHeight = composer.current?.offsetHeight;
    if (!active || !stack || composerHeight === undefined) return;
    const accessoryHeight = captureActionError ? 24 : 0;
    const viewport = feed.current;
    if (
      nearBottom.current &&
      viewport &&
      viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop > 1
    ) {
      viewport.scrollTo({ top: viewport.scrollHeight });
    }
    onMeasured(53 + stack.scrollHeight + 16 + composerHeight + accessoryHeight);
  }, [active, onMeasured, captureActionError]);

  useLayoutEffect(() => {
    if (!active) return;
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    const stack = feed.current?.firstElementChild;
    if (stack) observer.observe(stack);
    if (composer.current) observer.observe(composer.current);
    return () => observer.disconnect();
  }, [active, measure]);

  useEffect(() => {
    if (seq > 0 && nearBottom.current) {
      feed.current?.scrollTo({ top: feed.current.scrollHeight });
    }
  }, [seq]);

  const onFeedScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }, []);

  return { feed, composer, onFeedScroll };
}
