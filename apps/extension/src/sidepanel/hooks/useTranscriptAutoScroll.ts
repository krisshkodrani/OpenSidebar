import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import type { ChatEntry } from "../../types";

export function useTranscriptAutoScroll(
  visibleMessages: ChatEntry[],
  isAgentRunning: boolean,
): {
  scrollRef: RefObject<HTMLDivElement>;
  followLatest: () => void;
} {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldFollowLatestRef = useRef(true);
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

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const updateFollowState = () => {
      const distanceFromBottom =
        element.scrollHeight - element.scrollTop - element.clientHeight;
      shouldFollowLatestRef.current = distanceFromBottom < 120;
    };

    updateFollowState();
    element.addEventListener("scroll", updateFollowState, { passive: true });
    return () => element.removeEventListener("scroll", updateFollowState);
  }, []);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && shouldFollowLatestRef.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [scrollSignal]);

  return {
    scrollRef,
    followLatest: () => {
      shouldFollowLatestRef.current = true;
    },
  };
}
