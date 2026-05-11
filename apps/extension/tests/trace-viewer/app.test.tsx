import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import App from "../../src/trace-viewer/App";
import { useStore } from "../../src/trace-viewer/store";

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
vi.mock("../../src/trace-viewer/components/traces/SessionsTableView", () => ({
  default: () => <div>SessionsTableView</div>,
}));
vi.mock("../../src/trace-viewer/components/traces/RunsTableView", () => ({
  default: () => <div>RunsTableView</div>,
}));
vi.mock("../../src/trace-viewer/components/traces/MetricsTab", () => ({
  default: () => <div>MetricsTab</div>,
}));
vi.mock("../../src/trace-viewer/components/traces/DocsTab", () => ({
  default: () => <div>DocsTab</div>,
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
vi.mock("../../src/trace-viewer/components/BackendPanel", () => ({
  default: () => <div>BackendPanel</div>,
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

  test("renders backend panel from backend hash route", async () => {
    window.location.hash = "#view=backend";

    await act(async () => {
      root.render(<App />);
    });

    await waitFor(() => {
      expect(useStore.getState().activeSubview).toBe("overview");
      expect(container.textContent).toContain("BackendPanel");
      expect(container.textContent).not.toContain("UnifiedSessionsTableView");
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

  test("renders docs view from top-level hash route", async () => {
    window.location.hash = "#top=docs";

    await act(async () => {
      root.render(<App />);
    });

    await waitFor(() => {
      expect(useStore.getState().activeTopLevelView).toBe("docs");
      expect(container.textContent).toContain("DocsTab");
      expect(container.textContent).not.toContain("FilterBar");
      expect(container.textContent).not.toContain("FleetOverview");
      expect(container.textContent).not.toContain("FleetInsights");
    });
  });

  test("renders sessions as the default trace list", async () => {
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
});
