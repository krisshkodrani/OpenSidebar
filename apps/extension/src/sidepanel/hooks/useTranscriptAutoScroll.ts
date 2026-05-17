import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import type { RefObject } from "react";
import type { ChatEntry } from "../../types";

const FOLLOW_LATEST_THRESHOLD_PX = 120;

export function useTranscriptAutoScroll(
  visibleMessages: ChatEntry[],
  isAgentRunning: boolean,
): {
  scrollRef: RefObject<HTMLDivElement>;
  followLatest: () => void;
} {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldFollowLatestRef = useRef(true);
  const hasMountedRef = useRef(false);
  const previousVisibleCountRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const lastVisibleMessage = visibleMessages[visibleMessages.length - 1];
  const scrollSignal = useMemo(
    () =>
      [
        visibleMessages.length,
        isAgentRunning ? 1 : 0,
        lastVisibleMessage?.id ?? "",
        lastVisibleMessage?.content.length ?? 0,
        lastVisibleMessage?.isStreaming ? 1 : 0,
        lastVisibleMessage?.steps?.length ?? 0,
      ].join(":"),
    [visibleMessages, isAgentRunning, lastVisibleMessage],
  );

  const scrollToLatest = useCallback((force = false) => {
    if (force) {
      shouldFollowLatestRef.current = true;
    }

    const applyScroll = () => {
      const element = scrollRef.current;
      if (!element || (!force && !shouldFollowLatestRef.current)) return;
      element.scrollTop = element.scrollHeight;
    };

    applyScroll();

    if (animationFrameRef.current != null) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null;
      applyScroll();
    });
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const updateFollowState = () => {
      const distanceFromBottom =
        element.scrollHeight - element.scrollTop - element.clientHeight;
      shouldFollowLatestRef.current =
        distanceFromBottom < FOLLOW_LATEST_THRESHOLD_PX;
    };

    updateFollowState();
    element.addEventListener("scroll", updateFollowState, { passive: true });
    return () => element.removeEventListener("scroll", updateFollowState);
  }, []);

  useLayoutEffect(() => {
    const visibleCount = visibleMessages.length;
    const force =
      visibleCount > 0 &&
      (!hasMountedRef.current || previousVisibleCountRef.current === 0);

    scrollToLatest(force);
    hasMountedRef.current = true;
    previousVisibleCountRef.current = visibleCount;
  }, [scrollSignal, scrollToLatest, visibleMessages.length]);

  useEffect(() => {
    const forceFollowLatest = () => scrollToLatest(true);
    const forceFollowLatestWhenVisible = () => {
      if (document.visibilityState !== "visible") return;
      forceFollowLatest();
    };

    document.addEventListener("visibilitychange", forceFollowLatestWhenVisible);
    window.addEventListener("focus", forceFollowLatest);
    window.addEventListener("pageshow", forceFollowLatest);
    return () => {
      document.removeEventListener(
        "visibilitychange",
        forceFollowLatestWhenVisible,
      );
      window.removeEventListener("focus", forceFollowLatest);
      window.removeEventListener("pageshow", forceFollowLatest);
    };
  }, [scrollToLatest]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver(() => scrollToLatest(false));
    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollToLatest]);

  useEffect(
    () => () => {
      if (animationFrameRef.current != null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    },
    [],
  );

  return {
    scrollRef,
    followLatest: () => {
      shouldFollowLatestRef.current = true;
      scrollToLatest(true);
    },
  };
}
