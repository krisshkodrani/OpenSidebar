import React from "react";
import { act } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import SessionCompareView from "../../src/trace-viewer/components/traces/SessionCompareView";
import { useStore } from "../../src/trace-viewer/store";

const fetchTraceEntriesMock = vi.fn();

vi.mock("../../src/trace-viewer/api", () => ({
  fetchTraceEntries: (sessionId: string) => fetchTraceEntriesMock(sessionId),
}));

function resetStore() {
  useStore.setState((useStore as any).getInitialState(), true);
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("SessionCompareView", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetStore();
    fetchTraceEntriesMock.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  test("loads two traces and renders comparison summary", async () => {
    useStore.setState({
      compareSessionIds: ["s1", "s2"],
      compareViewActive: true,
    } as any);

    fetchTraceEntriesMock.mockImplementation(async (sessionId: string) => {
      if (sessionId === "s1") {
        return [
          {
            sessionId: "s1",
            turnNumber: 1,
            timestamp: 1,
            snapshot: { url: "https://example.com/a", title: "A", elementCount: 1, visibleContentLength: 1, scrollY: 0 },
            elements: [],
            llmRequest: { model: "openai/gpt-5.4-mini:nitro", messageCount: 1, toolCount: 1, compressionLevel: "none" },
            llmResponse: { content: null, toolCalls: [], finishReason: "stop", usage: null, durationMs: 100 },
            toolExecutions: [{ toolCallId: "1", toolName: "click", args: {}, result: "ok", success: true, durationMs: 10, riskLevel: "low" }],
            events: [],
            progressState: { stagnantTurns: 0, signal: null },
          },
        ];
      }
      return [
        {
          sessionId: "s2",
          turnNumber: 1,
          timestamp: 1,
          snapshot: { url: "https://example.com/b", title: "B", elementCount: 1, visibleContentLength: 1, scrollY: 0 },
          elements: [],
          llmRequest: { model: "openai/gpt-5.4", messageCount: 1, toolCount: 1, compressionLevel: "none" },
          llmResponse: { content: null, toolCalls: [], finishReason: "stop", usage: null, durationMs: 100 },
          toolExecutions: [{ toolCallId: "2", toolName: "scroll", args: {}, result: "ok", success: true, durationMs: 10, riskLevel: "low" }],
          events: [],
          progressState: { stagnantTurns: 0, signal: null },
        },
      ];
    });

    await act(async () => {
      root.render(
        <SessionCompareView
          sessions={[
            {
              sessionId: "s1",
              startTime: 100,
              endTime: 200,
              query: "Objective: Left flow",
              startUrl: "https://example.com",
              outcome: "completed",
              turnCount: 1,
              summary: "done",
              metrics: { totalCost: 0.1, modelBreakdown: { "openai/gpt-5.4-mini:nitro": { calls: 1 } } },
            },
            {
              sessionId: "s2",
              startTime: 100,
              endTime: 260,
              query: "Objective: Right flow",
              startUrl: "https://example.com",
              outcome: "error",
              turnCount: 1,
              summary: "failed",
              metrics: { totalCost: 0.3, modelBreakdown: { "openai/gpt-5.4": { calls: 1 } } },
            },
          ] as any}
        />,
      );
    });

    await flushAsyncWork();

    expect(fetchTraceEntriesMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Diff Summary");
    expect(container.textContent).toContain("first divergence");
    expect(container.textContent).toContain("completed");
    expect(container.textContent).toContain("error");
    expect(container.textContent).toContain("gpt-5.4-mini:nitro");
  });
});
