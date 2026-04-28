import React from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import type { TraceEntry, TraceSession } from "../../src/types/traces";
import SessionComparisonPanel from "../../src/trace-viewer/components/traces/SessionComparisonPanel";
import TimelineDiffPanel from "../../src/trace-viewer/components/traces/TimelineDiffPanel";
import { useStore } from "../../src/trace-viewer/store";

const mockFetchTraceEntries = vi.hoisted(() => vi.fn());

vi.mock("../../src/trace-viewer/api", () => ({
  fetchTraceEntries: (...args: unknown[]) => mockFetchTraceEntries(...args),
}));

function resetStore() {
  useStore.setState((useStore as any).getInitialState(), true);
}

function session(overrides: Partial<TraceSession> = {}): TraceSession {
  return {
    sessionId: "base",
    runId: "run-1",
    startTime: 100,
    endTime: 200,
    query: "Objective: Checkout",
    startUrl: "https://shop.example.com/cart",
    outcome: "error",
    failureCode: "tool_click_failed",
    turnCount: 1,
    summary: "failed",
    metrics: { totalCost: 0.01 } as any,
    models: ["model-a"],
    ...overrides,
  };
}

function entry(overrides: Partial<TraceEntry> = {}): TraceEntry {
  return {
    sessionId: "base",
    turnNumber: 1,
    timestamp: 100,
    snapshot: {
      url: "https://shop.example.com/cart",
      title: "Cart",
      elementCount: 2,
      visibleContentLength: 20,
      scrollY: 0,
    },
    elements: [],
    llmRequest: {
      model: "model-a",
      messageCount: 1,
      toolCount: 1,
      compressionLevel: "none",
    },
    llmResponse: {
      content: null,
      toolCalls: [
        {
          id: "tc-1",
          type: "function",
          function: { name: "click_element" as any, arguments: "{}" },
        },
      ],
      finishReason: "tool_calls",
      usage: null,
      durationMs: 100,
    },
    toolExecutions: [
      {
        toolCallId: "tc-1",
        toolName: "click_element",
        args: {},
        result: "element detached",
        success: false,
        durationMs: 10,
        riskLevel: "low",
      },
    ],
    events: [],
    progressState: { stagnantTurns: 0, signal: null },
    ...overrides,
  };
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitFor(check: () => void, attempts = 20) {
  let lastError: unknown;
  for (let index = 0; index < attempts; index += 1) {
    try {
      check();
      return;
    } catch (error) {
      lastError = error;
      await flushAsyncWork();
    }
  }
  throw lastError;
}

describe("trace comparison panels", () => {
  let container: HTMLDivElement;
  let root: Root;
  const base = session();
  const related = session({
    sessionId: "related",
    runId: "run-2",
    query: "Objective: Checkout retry",
    startUrl: "https://shop.example.com/payment",
    turnCount: 2,
    metrics: { totalCost: 0.02 } as any,
  });

  beforeEach(() => {
    resetStore();
    mockFetchTraceEntries.mockReset();
    useStore.setState({
      sessions: [base, related],
      currentSessionId: base.sessionId,
      currentEntries: [entry()],
    } as any);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  test("renders related sessions and can navigate to a match", async () => {
    await act(async () => {
      root.render(<SessionComparisonPanel session={base} />);
    });

    expect(container.textContent).toContain("Related Sessions");
    expect(container.textContent).toContain("same failure");
    expect(container.textContent).toContain("Checkout retry");

    const relatedButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Checkout retry"),
    );
    expect(relatedButton).toBeTruthy();

    await act(async () => {
      relatedButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(useStore.getState().currentSessionId).toBe("related");
    expect(useStore.getState().currentEntries).toEqual([]);
    expect(useStore.getState().activeSubview).toBe("overview");
  });

  test("renders first turn divergence after loading related entries", async () => {
    mockFetchTraceEntries.mockResolvedValue([
      entry({
        sessionId: "related",
        toolExecutions: [
          {
            toolCallId: "tc-1",
            toolName: "click_element",
            args: {},
            result: "clicked",
            success: true,
            durationMs: 10,
            riskLevel: "low",
          },
        ],
      }),
    ]);

    await act(async () => {
      root.render(<TimelineDiffPanel session={base} />);
    });

    await waitFor(() => {
      expect(mockFetchTraceEntries).toHaveBeenCalledWith("related");
      expect(container.textContent).toContain("Turn Diff");
      expect(container.textContent).toContain("First divergence at T1");
      expect(container.textContent).toContain("Tool result changed");
      expect(container.textContent).toContain("click_element:ok");
    });
  });
});
