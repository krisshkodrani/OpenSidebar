import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import { useTranscriptAutoScroll } from "../../src/sidepanel/hooks/useTranscriptAutoScroll";
import type { ChatEntry } from "../../src/types";

type HarnessControls = {
  element: HTMLDivElement | null;
  followLatest: () => void;
};

function message(overrides: Partial<ChatEntry> = {}): ChatEntry {
  return {
    id: "assistant-1",
    role: "assistant",
    content: "Assistant response",
    timestamp: 1000,
    toolCalls: [],
    isStreaming: false,
    ...overrides,
  };
}

function setScrollMetrics(
  element: HTMLDivElement,
  metrics: { clientHeight: number; scrollHeight: number },
) {
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: metrics.clientHeight,
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: metrics.scrollHeight,
  });
}

function TranscriptHarness({
  clientHeight = 300,
  isAgentRunning = false,
  messages,
  onReady,
  scrollHeight,
}: {
  clientHeight?: number;
  isAgentRunning?: boolean;
  messages: ChatEntry[];
  onReady: (controls: HarnessControls) => void;
  scrollHeight: number;
}) {
  const { scrollRef, followLatest } = useTranscriptAutoScroll(
    messages,
    isAgentRunning,
  );
  const ref = (node: HTMLDivElement | null) => {
    (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    if (node) setScrollMetrics(node, { clientHeight, scrollHeight });
  };

  React.useEffect(() => {
    onReady({ element: scrollRef.current, followLatest });
  }, [followLatest, onReady, scrollRef]);

  return (
    <div data-testid="transcript" ref={ref}>
      {messages.map((item) => (
        <div key={item.id}>{item.content}</div>
      ))}
    </div>
  );
}

describe("useTranscriptAutoScroll", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controls: HarnessControls;
  let originalRequestAnimationFrame: typeof requestAnimationFrame;
  let originalCancelAnimationFrame: typeof cancelAnimationFrame;

  beforeEach(() => {
    originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  test("scrolls to the latest message on initial render with existing messages", async () => {
    await act(async () => {
      root.render(
        <TranscriptHarness
          messages={[message()]}
          onReady={(next) => {
            controls = next;
          }}
          scrollHeight={960}
        />,
      );
    });

    expect(controls.element?.scrollTop).toBe(960);
  });

  test("scrolls to the latest message when restored messages appear after an empty state", async () => {
    await act(async () => {
      root.render(
        <TranscriptHarness
          messages={[]}
          onReady={(next) => {
            controls = next;
          }}
          scrollHeight={700}
        />,
      );
    });

    await act(async () => {
      controls.element!.scrollTop = 0;
      controls.element!.dispatchEvent(new Event("scroll"));
      root.render(
        <TranscriptHarness
          messages={[message()]}
          onReady={(next) => {
            controls = next;
          }}
          scrollHeight={1040}
        />,
      );
    });

    expect(controls.element?.scrollTop).toBe(1040);
  });

  test("does not pull the user down during streaming when they scrolled upward", async () => {
    await act(async () => {
      root.render(
        <TranscriptHarness
          messages={[message({ content: "First chunk", isStreaming: true })]}
          onReady={(next) => {
            controls = next;
          }}
          scrollHeight={1000}
        />,
      );
    });

    await act(async () => {
      controls.element!.scrollTop = 100;
      controls.element!.dispatchEvent(new Event("scroll"));
      root.render(
        <TranscriptHarness
          messages={[
            message({
              content: "First chunk plus a little more",
              isStreaming: true,
            }),
          ]}
          onReady={(next) => {
            controls = next;
          }}
          scrollHeight={1200}
        />,
      );
    });

    expect(controls.element?.scrollTop).toBe(100);
  });

  test("forces latest message into view when the panel becomes visible again", async () => {
    await act(async () => {
      root.render(
        <TranscriptHarness
          messages={[message()]}
          onReady={(next) => {
            controls = next;
          }}
          scrollHeight={1000}
        />,
      );
    });

    await act(async () => {
      controls.element!.scrollTop = 0;
      controls.element!.dispatchEvent(new Event("scroll"));
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(controls.element?.scrollTop).toBe(1000);
  });

  test("followLatest re-enables bottom following for the next update", async () => {
    await act(async () => {
      root.render(
        <TranscriptHarness
          messages={[message({ content: "Before followLatest" })]}
          onReady={(next) => {
            controls = next;
          }}
          scrollHeight={1000}
        />,
      );
    });

    await act(async () => {
      controls.element!.scrollTop = 100;
      controls.element!.dispatchEvent(new Event("scroll"));
      controls.followLatest();
      root.render(
        <TranscriptHarness
          messages={[message({ content: "After followLatest" })]}
          onReady={(next) => {
            controls = next;
          }}
          scrollHeight={1250}
        />,
      );
    });

    expect(controls.element?.scrollTop).toBe(1250);
  });
});
