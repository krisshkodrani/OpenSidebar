import React from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import App from "../../src/trace-viewer/App";
import { useStore } from "../../src/trace-viewer/store";

const mockFetchTraceSessions = vi.fn();
const mockFetchTraceSessionsPage = vi.fn();
const mockFetchTraceSessionSummary = vi.fn();
const mockFetchTraceDays = vi.fn();
const mockFetchTraceModels = vi.fn();
const mockFetchTraceEntries = vi.fn();
const mockFetchRunTraceEvents = vi.fn();
const mockFetchSessionLogs = vi.fn();
const mockScrollToIndex = vi.fn();

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 220,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        key: index,
        index,
        start: index * 220,
      })),
    measureElement: () => undefined,
    scrollToIndex: (...args: unknown[]) => mockScrollToIndex(...args),
  }),
}));

vi.mock("../../src/trace-viewer/api", () => ({
  TRACE_SESSION_SEARCH_LIMIT: 1000,
  fetchTraceSessions: (...args: unknown[]) => mockFetchTraceSessions(...args),
  fetchTraceSessionsPage: (...args: unknown[]) =>
    mockFetchTraceSessionsPage(...args),
  fetchTraceSessionSummary: (...args: unknown[]) =>
    mockFetchTraceSessionSummary(...args),
  fetchTraceDays: (...args: unknown[]) => mockFetchTraceDays(...args),
  fetchTraceModels: (...args: unknown[]) => mockFetchTraceModels(...args),
  fetchTraceEntries: (...args: unknown[]) => mockFetchTraceEntries(...args),
  fetchRunTraceEvents: (...args: unknown[]) => mockFetchRunTraceEvents(...args),
  fetchSessionLogs: (...args: unknown[]) => mockFetchSessionLogs(...args),
  screenshotUrl: (sessionId: string, turn: number) =>
    `http://127.0.0.1:7589/traces/${sessionId}/screenshots/${turn}.jpg`,
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

const sessions = [
  {
    sessionId: "session-alpha",
    runId: "run-alpha",
    startTime: Date.UTC(2026, 3, 20, 9, 0, 0),
    endTime: Date.UTC(2026, 3, 20, 9, 1, 0),
    query: "Objective: Audit viewer trace navigation",
    startUrl: "https://example.com/viewer",
    outcome: "completed",
    turnCount: 2,
    summary: "done",
    metrics: {
      totalCost: 0.03,
      modelBreakdown: { "openai/gpt-5.4-mini:nitro": { calls: 2 } },
    },
  },
  {
    sessionId: "session-beta",
    runId: "run-beta",
    startTime: Date.UTC(2026, 3, 20, 10, 0, 0),
    endTime: Date.UTC(2026, 3, 20, 10, 1, 30),
    query: "Objective: Compare viewer trace output",
    startUrl: "https://example.com/compare",
    outcome: "error",
    turnCount: 1,
    summary: "failed",
    metrics: {
      totalCost: 0.05,
      modelBreakdown: { "openai/gpt-5.4": { calls: 1 } },
    },
  },
] as any[];

const entriesBySessionId: Record<string, any[]> = {
  "session-alpha": [
    {
      sessionId: "session-alpha",
      turnNumber: 1,
      timestamp: Date.UTC(2026, 3, 20, 9, 0, 0),
      snapshot: {
        url: "https://example.com/viewer",
        title: "Viewer",
        elementCount: 5,
        visibleContentLength: 100,
        scrollY: 0,
      },
      elements: [],
      llmRequest: {
        model: "openai/gpt-5.4-mini:nitro",
        modelTier: "executor",
        messages: [{ role: "user", content: "Open the viewer trace." }],
      },
      llmResponse: {
        content: "I can see the viewer trace list.",
        toolCalls: [],
        finishReason: "stop",
        usage: { total_tokens: 120, cost: 0.01 },
        durationMs: 1000,
      },
      toolExecutions: [],
      events: [],
      progressState: { stagnantTurns: 0, signal: null },
    },
    {
      sessionId: "session-alpha",
      turnNumber: 2,
      timestamp: Date.UTC(2026, 3, 20, 9, 0, 30),
      snapshot: {
        url: "https://example.com/viewer/detail",
        title: "Trace Detail",
        elementCount: 8,
        visibleContentLength: 200,
        scrollY: 20,
      },
      elements: [],
      llmRequest: {
        model: "openai/gpt-5.4-mini:nitro",
        modelTier: "planner",
        messages: [{ role: "assistant", content: "Inspect detail turns." }],
      },
      llmResponse: {
        content: null,
        toolCalls: [
          {
            function: {
              name: "click",
              arguments: JSON.stringify({ id: 4 }),
            },
          },
        ],
        finishReason: "tool_calls",
        usage: { total_tokens: 180, cost: 0.02 },
        durationMs: 2000,
      },
      toolExecutions: [
        {
          toolName: "click",
          success: true,
          result: "Clicked trace row",
          durationMs: 20,
        },
      ],
      events: [],
      progressState: { stagnantTurns: 0, signal: null },
    },
  ],
  "session-beta": [
    {
      sessionId: "session-beta",
      turnNumber: 1,
      timestamp: Date.UTC(2026, 3, 20, 10, 0, 0),
      snapshot: {
        url: "https://example.com/compare",
        title: "Compare",
        elementCount: 4,
        visibleContentLength: 80,
        scrollY: 0,
      },
      elements: [],
      llmRequest: {
        model: "openai/gpt-5.4",
        modelTier: "executor",
        messages: [{ role: "user", content: "Compare a second trace." }],
      },
      llmResponse: {
        content: "Comparison trace failed after one turn.",
        toolCalls: [],
        finishReason: "stop",
        usage: { total_tokens: 100, cost: 0.05 },
        durationMs: 1500,
      },
      toolExecutions: [],
      events: [],
      progressState: { stagnantTurns: 0, signal: null },
    },
  ],
};

describe("trace-viewer App regression flows", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetStore();
    mockFetchTraceSessions.mockReset();
    mockFetchTraceSessionsPage.mockReset();
    mockFetchTraceSessionSummary.mockReset();
    mockFetchTraceDays.mockReset();
    mockFetchTraceModels.mockReset();
    mockFetchTraceEntries.mockReset();
    mockFetchRunTraceEvents.mockReset();
    mockFetchSessionLogs.mockReset();
    mockScrollToIndex.mockReset();

    mockFetchTraceSessions.mockResolvedValue(sessions);
    mockFetchTraceSessionsPage.mockResolvedValue({
      items: sessions,
      total: sessions.length,
      nextCursor: null,
      hasMore: false,
    });
    mockFetchTraceSessionSummary.mockImplementation((sessionId: string) =>
      Promise.resolve(
        sessions.find((session) => session.sessionId === sessionId) ?? null,
      ),
    );
    mockFetchTraceDays.mockResolvedValue([{ day: "2026-04-20", count: 2 }]);
    mockFetchTraceModels.mockResolvedValue([
      { model: "openai/gpt-5.4-mini:nitro", count: 2 },
      { model: "openai/gpt-5.4", count: 1 },
    ]);
    mockFetchTraceEntries.mockImplementation((sessionId: string) =>
      Promise.resolve(entriesBySessionId[sessionId] ?? []),
    );
    mockFetchRunTraceEvents.mockResolvedValue([]);
    mockFetchSessionLogs.mockResolvedValue([]);

    // These flows exercise the Runs list — the viewer's default landing.
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    window.location.hash = "";
  });

  test("can load trace sessions, open a trace, render turns, and use timeline navigation", async () => {
    await act(async () => {
      root.render(<App />);
    });

    await waitFor(() => {
      expect(container.textContent).toContain("Audit viewer trace navigation");
      expect(container.textContent).toContain("Compare");
    });

    // Single-session run groups render pre-expanded; open the session row.
    const row = Array.from(
      container.querySelectorAll('div[role="button"]'),
    ).find((candidate) =>
      candidate.textContent?.includes("Audit viewer trace navigation"),
    );
    expect(row).toBeTruthy();

    await act(async () => {
      row!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // A trace opens on Evidence, with Model I/O promoted to a first-class tab.
    await waitFor(() => {
      const tabLabels = Array.from(container.querySelectorAll("button")).map(
        (button) => button.textContent ?? "",
      );
      expect(tabLabels).toContain("Evidence");
      expect(tabLabels).toContain("Plan");
      expect(tabLabels.some((label) => label.startsWith("Timeline"))).toBe(true);
      expect(tabLabels).toContain("Model I/O");
      expect(tabLabels).toContain("Raw");
    });

    const turnsTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.startsWith("Timeline"),
    );
    expect(turnsTab).toBeTruthy();

    await act(async () => {
      turnsTab!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitFor(() => {
      expect(container.textContent).toContain("Turn Timeline");
      expect(container.textContent).toContain("Turn 1");
      expect(container.textContent).toContain("Turn 2");
      expect(container.querySelector("#turn-2")).toBeTruthy();
    });

    const jumpToTurnTwo = container.querySelector(
      'button[aria-label="Jump to turn 2"]',
    ) as HTMLButtonElement | null;
    expect(jumpToTurnTwo).toBeTruthy();

    await act(async () => {
      jumpToTurnTwo!.click();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockScrollToIndex).toHaveBeenCalledWith(1, { align: "start" });
    });

    const modelIOTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Model I/O",
    );
    expect(modelIOTab).toBeTruthy();

    await act(async () => {
      modelIOTab!.click();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(container.textContent).toContain("Recorded effective messages");
      expect(container.textContent).toContain("Open the viewer trace.");
      expect(container.textContent).toContain("I can see the viewer trace list.");
      expect(container.textContent).toContain("Recorded tool outcomes");
    });
  });

  test("defaults to the runs list and can open a second trace", async () => {
    await act(async () => {
      root.render(<App />);
    });

    await waitFor(() => {
      expect(container.textContent).toContain("Audit viewer trace navigation");
      expect(container.textContent).toContain("Compare viewer trace output");
    });

    expect(useStore.getState().activeTopLevelView).toBe("runs");

    const row = Array.from(
      container.querySelectorAll('div[role="button"]'),
    ).find((candidate) =>
      candidate.textContent?.includes("Compare viewer trace output"),
    );
    expect(row).toBeTruthy();

    await act(async () => {
      row!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Opens on the evidence-first subview with Model I/O directly reachable.
    await waitFor(() => {
      expect(container.textContent).toContain("Compare viewer trace output");
      const tabLabels = Array.from(container.querySelectorAll("button")).map(
        (button) => button.textContent ?? "",
      );
      expect(tabLabels).toContain("Evidence");
      expect(tabLabels).toContain("Model I/O");
      expect(tabLabels).toContain("Raw");
    });
  });
});
