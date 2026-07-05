import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import App from "../../src/trace-viewer/App";
import { useStore } from "../../src/trace-viewer/store";
import { TRACE_SESSION_SEARCH_LIMIT } from "../../src/trace-viewer/api";

const mockUseTraceData = vi.fn();

vi.mock("../../src/trace-viewer/hooks/useTraceData", () => ({
  useTraceData: () => mockUseTraceData(),
}));

vi.mock("../../src/trace-viewer/components/ViewerHeader", () => ({
  default: () => <div>ViewerHeader</div>,
}));
vi.mock("../../src/trace-viewer/components/ViewerErrorBoundary", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../../src/trace-viewer/components/traces/FleetOverview", () => ({
  default: () => <div>FleetOverview</div>,
}));
vi.mock("../../src/trace-viewer/components/traces/FleetInsights", () => ({
  default: () => <div>FleetInsights</div>,
}));
vi.mock("../../src/trace-viewer/components/traces/FilterBar", () => ({
  default: () => <div>FilterBar</div>,
}));
vi.mock("../../src/trace-viewer/components/traces/RunsTableView", () => ({
  default: () => <div>RunsTableView</div>,
}));
vi.mock("../../src/trace-viewer/components/traces/MetricsTab", () => ({
  default: () => <div>MetricsTab</div>,
}));
vi.mock(
  "../../src/trace-viewer/components/traces/UnifiedSessionsTableView",
  () => ({
    default: () => <div>UnifiedSessionsTableView</div>,
  }),
);
vi.mock("../../src/trace-viewer/components/traces/TraceListModeToggle", () => ({
  default: () => <div>TraceListModeToggle</div>,
}));
vi.mock("../../src/trace-viewer/components/ErrorBanner", () => ({
  default: ({ message }: { message: string }) => <div>{message}</div>,
}));
vi.mock("../../src/trace-viewer/components/LoadingSpinner", () => ({
  default: ({ message }: { message: string }) => <div>{message}</div>,
}));
vi.mock("../../src/trace-viewer/components/traces/TraceDetailHeader", () => ({
  default: ({ session }: { session: { sessionId: string } }) => (
    <div>TraceDetailHeader:{session.sessionId}</div>
  ),
}));
vi.mock("../../src/trace-viewer/components/traces/TraceSubviewToggle", () => ({
  default: () => <div>TraceSubviewToggle</div>,
}));
vi.mock("../../src/trace-viewer/components/traces/TurnSearchBar", () => ({
  default: () => <div>TurnSearchBar</div>,
}));
vi.mock("../../src/trace-viewer/components/traces/TurnList", () => ({
  default: () => <div>TurnList</div>,
}));
vi.mock("../../src/trace-viewer/components/traces/TurnTimeline", () => ({
  default: () => <div>TurnTimeline</div>,
}));
vi.mock("../../src/trace-viewer/components/traces/PerceptionList", () => ({
  default: () => <div>PerceptionList</div>,
}));
vi.mock("../../src/trace-viewer/components/traces/LogList", () => ({
  default: () => <div>LogList</div>,
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

async function waitFor(check: () => void, attempts = 10) {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
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

describe("trace-viewer App", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetStore();
    mockUseTraceData.mockReset();
    mockUseTraceData.mockReturnValue({
      sessions: [],
      currentSessionId: null,
      refreshSessions: vi.fn(),
    });
    window.location.hash = "";
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

  test("hydrates session and subview from hash", async () => {
    window.location.hash = "#session=session-1&view=logs";
    mockUseTraceData.mockReturnValue({
      sessions: [
        {
          sessionId: "session-1",
          startTime: 100,
          endTime: 200,
          query: "Objective: test",
          startUrl: "https://example.com",
          outcome: "completed",
          turnCount: 2,
          summary: "done",
          metrics: null,
        },
      ],
      currentSessionId: "session-1",
      refreshSessions: vi.fn(),
    });

    await act(async () => {
      root.render(<App />);
    });

    await waitFor(() => {
      expect(useStore.getState().currentSessionId).toBe("session-1");
      expect(useStore.getState().activeSubview).toBe("logs");
      expect(container.textContent).toContain("TraceDetailHeader:session-1");
      expect(container.textContent).toContain("LogList");
    });
  });

  test("renders metrics view from top-level hash route", async () => {
    window.location.hash = "#top=metrics";

    await act(async () => {
      root.render(<App />);
    });

    await waitFor(() => {
      expect(useStore.getState().activeTopLevelView).toBe("metrics");
      expect(container.textContent).toContain("MetricsTab");
      expect(container.textContent).not.toContain("FleetOverview");
      expect(container.textContent).not.toContain("FleetInsights");
    });
  });

  test("ignores unknown top-level hash routes", async () => {
    window.location.hash = "#top=docs";

    await act(async () => {
      root.render(<App />);
    });

    await waitFor(() => {
      expect(useStore.getState().activeTopLevelView).toBe("sessions");
      expect(container.textContent).toContain("UnifiedSessionsTableView");
      expect(container.textContent).toContain("FilterBar");
      expect(container.textContent).toContain("FleetOverview");
      expect(container.textContent).toContain("FleetInsights");
    });
  });

  test("renders traces as the default trace list", async () => {
    mockUseTraceData.mockReturnValue({
      sessions: [
        {
          sessionId: "session-1",
          startTime: 100,
          endTime: 200,
          query: "Objective: left",
          startUrl: "https://example.com",
          outcome: "completed",
          turnCount: 2,
          summary: "done",
          metrics: null,
        },
        {
          sessionId: "session-2",
          startTime: 100,
          endTime: 240,
          query: "Objective: right",
          startUrl: "https://example.com",
          outcome: "error",
          turnCount: 2,
          summary: "failed",
          metrics: null,
        },
      ],
      currentSessionId: null,
      refreshSessions: vi.fn(),
    });

    await act(async () => {
      root.render(<App />);
    });

    await waitFor(() => {
      expect(useStore.getState().traceListMode).toBe("sessions");
      expect(container.textContent).toContain("UnifiedSessionsTableView");
      expect(container.textContent).toContain("FleetInsights");
    });
  });

  test("only list-backed top-level tabs show count badges", async () => {
    useStore.getState().setSessions([
      {
        sessionId: "session-1",
        runId: "run-1",
        startTime: 100,
        endTime: 200,
        query: "Objective: left",
        startUrl: "https://example.com",
        outcome: "completed",
        turnCount: 2,
        summary: "done",
        metrics: null,
      },
      {
        sessionId: "session-2",
        runId: "run-1",
        startTime: 210,
        endTime: 240,
        query: "Objective: right",
        startUrl: "https://example.com",
        outcome: "error",
        turnCount: 2,
        summary: "failed",
        metrics: null,
      },
    ] as any);

    await act(async () => {
      root.render(<App />);
    });

    await waitFor(() => {
      const text = container.textContent ?? "";
      expect(container.textContent).toContain("Runs (1)");
      expect(container.textContent).toContain("Traces (2)");
      expect(text.indexOf("Runs (1)")).toBeLessThan(
        text.indexOf("Traces (2)"),
      );
      expect(container.textContent).toContain("Insights");
      expect(container.textContent).toContain("Metrics");
      expect(container.textContent).not.toContain("Insights (2)");
      expect(container.textContent).not.toContain("Metrics (2)");
    });
  });

  test("marks list-backed tab counts as capped at the loaded search limit", async () => {
    const sessions = Array.from(
      { length: TRACE_SESSION_SEARCH_LIMIT },
      (_, index) => ({
        sessionId: `session-${index}`,
        runId: "run-1",
        startTime: 100 + index,
        endTime: 200 + index,
        query: `Objective: trace ${index}`,
        startUrl: "https://example.com",
        outcome: "completed",
        turnCount: 1,
        summary: "done",
        metrics: null,
      }),
    );

    useStore.setState({
      sessions,
      runGroups: [
        {
          runId: "run-1",
          shortId: "run-1",
          sessions,
          totalTurns: sessions.length,
          totalCost: 0,
          earliestStart: 100,
          latestEnd: 200,
          overallOutcome: "completed",
          query: "Objective: trace 0",
          expanded: false,
        },
      ],
    } as any);

    await act(async () => {
      root.render(<App />);
    });

    await waitFor(() => {
      expect(container.textContent).toContain("Runs (1+)");
      expect(container.textContent).toContain("Traces (1,000+)");
      expect(container.textContent).not.toContain("Insights (1,000+)");
      expect(container.textContent).not.toContain("Metrics (1,000+)");
    });
  });

  test("renders selected session detail with a capped scrollable summary", async () => {
    useStore.setState({
      currentSessionId: "session-1",
      activeSubview: "turns",
      currentEntries: [
        {
          sessionId: "session-1",
          turnNumber: 1,
          timestamp: 100,
          snapshot: null,
          elements: [],
          llmRequest: null,
          llmResponse: null,
          toolExecutions: [],
          events: [],
          progressState: { stagnantTurns: 0, signal: null },
        },
      ],
    } as any);
    mockUseTraceData.mockReturnValue({
      sessions: [
        {
          sessionId: "session-1",
          startTime: 100,
          endTime: 200,
          query: "Objective: inspect detail scroll affordance",
          startUrl: "https://example.com",
          outcome: "completed",
          turnCount: 1,
          summary: "done",
          metrics: null,
        },
      ],
      currentSessionId: "session-1",
      refreshSessions: vi.fn(),
    });

    await act(async () => {
      root.render(<App />);
    });

    await waitFor(() => {
      const summary = container.querySelector(".session-detail-summary");

      expect(summary).toBeTruthy();
      expect(summary?.className).toContain("overflow-y-auto");
      expect(summary?.className).toContain("scrollbar-thin");
      expect(summary?.className).toContain("scroll-shadow-y");
      expect(summary?.textContent).toContain("TraceDetailHeader:session-1");
      expect(container.textContent).toContain("TurnList");
    });
  });

  // --- Scroll save / restore / flush guard (perf hardening) ---

  function detailSession(sessionId: string) {
    return {
      sessionId,
      startTime: 100,
      endTime: 200,
      query: `Objective: ${sessionId}`,
      startUrl: "https://example.com",
      outcome: "completed",
      turnCount: 1,
      summary: "done",
      metrics: null,
    };
  }

  function getScrollContainer(): HTMLElement {
    const el = container.querySelector<HTMLElement>(
      ".flex-1.min-h-0.overflow-y-auto",
    );
    if (!el) throw new Error("scroll container not found");
    return el;
  }

  async function renderDetail(sessionId: string, sessions = [detailSession(sessionId)]) {
    useStore.setState({ currentSessionId: sessionId, activeSubview: "overview" });
    mockUseTraceData.mockReturnValue({
      sessions,
      currentSessionId: sessionId,
      refreshSessions: vi.fn(),
    });
    await act(async () => {
      root.render(<App />);
    });
    await waitFor(() => {
      getScrollContainer();
    });
  }

  function setScrollTop(el: HTMLElement, value: number) {
    // happy-dom does not lay out content, so make scrollTop a real stored value.
    Object.defineProperty(el, "scrollTop", {
      configurable: true,
      writable: true,
      value,
    });
  }

  test("saves scroll position to the store keyed by session and subview", async () => {
    await renderDetail("session-1");
    const el = getScrollContainer();

    setScrollTop(el, 120);
    await act(async () => {
      el.dispatchEvent(new Event("scroll"));
    });
    await flushAsyncWork();

    expect(useStore.getState().scrollPositions["session-1:overview"]).toBe(120);
  });

  test("restores the saved scroll position when the subview changes", async () => {
    useStore.setState({
      scrollPositions: { "session-1:perception": 88 },
    } as any);
    await renderDetail("session-1");
    const el = getScrollContainer();
    expect(el.scrollTop).toBe(0);

    await act(async () => {
      useStore.getState().setActiveSubview("perception");
    });
    await flushAsyncWork();

    expect(getScrollContainer().scrollTop).toBe(88);
  });

  test("does not write a leaving session's scroll under the new session's key", async () => {
    await renderDetail("session-1", [
      detailSession("session-1"),
      detailSession("session-2"),
    ]);
    const el = getScrollContainer();

    // Scroll session-1, but switch to session-2 before the rAF flush runs.
    setScrollTop(el, 200);
    el.dispatchEvent(new Event("scroll"));
    await act(async () => {
      mockUseTraceData.mockReturnValue({
        sessions: [detailSession("session-1"), detailSession("session-2")],
        currentSessionId: "session-2",
        refreshSessions: vi.fn(),
      });
      useStore.getState().setCurrentSessionId("session-2");
    });
    await flushAsyncWork();

    // session-1's scrollTop (200) must not leak under session-2's key.
    expect(
      useStore.getState().scrollPositions["session-2:overview"],
    ).not.toBe(200);
  });
});
