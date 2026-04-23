import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import { useStore } from "../../src/trace-viewer/store";
import { useTraceData } from "../../src/trace-viewer/hooks/useTraceData";
import * as api from "../../src/trace-viewer/api";

vi.mock("../../src/trace-viewer/api", async () => {
  const actual = await vi.importActual("../../src/trace-viewer/api");
  return {
    ...actual,
    fetchTraceSessions: vi.fn(),
    fetchTraceDays: vi.fn(),
    fetchTraceModels: vi.fn(),
    fetchTraceEntries: vi.fn(),
    fetchRunTraceEvents: vi.fn(),
    fetchSessionLogs: vi.fn(),
  };
});

function resetStore() {
  useStore.setState((useStore as any).getInitialState(), true);
}

function HookHarness() {
  useTraceData();
  return null;
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
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

describe("useTraceData", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    vi.mocked(api.fetchTraceSessions).mockResolvedValue([]);
    vi.mocked(api.fetchTraceDays).mockResolvedValue([]);
    vi.mocked(api.fetchTraceModels).mockResolvedValue([]);
    vi.mocked(api.fetchTraceEntries).mockResolvedValue([]);
    vi.mocked(api.fetchRunTraceEvents).mockResolvedValue([]);
    vi.mocked(api.fetchSessionLogs).mockResolvedValue([]);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  test("loads sessions, day buckets, and model buckets on mount", async () => {
    vi.mocked(api.fetchTraceSessions).mockResolvedValue([
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
    ] as any);
    vi.mocked(api.fetchTraceDays).mockResolvedValue([
      { day: "2026-04-15", count: 1 },
    ]);
    vi.mocked(api.fetchTraceModels).mockResolvedValue([
      { model: "openai/gpt-5.4-mini:nitro", count: 1 },
    ]);

    await act(async () => {
      root.render(<HookHarness />);
    });
    await waitFor(() => {
      expect(useStore.getState().sessions).toHaveLength(1);
      expect(useStore.getState().availableDays).toEqual([
        { day: "2026-04-15", count: 1 },
      ]);
      expect(useStore.getState().availableModels).toEqual([
        { model: "openai/gpt-5.4-mini:nitro", count: 1 },
      ]);
      expect(useStore.getState().tracesError).toBeNull();
    });
  });

  test("clears current session when refresh no longer contains it", async () => {
    useStore.setState({
      currentSessionId: "missing-session",
      currentEntries: [{ turnNumber: 1 }],
      currentRunEvents: [{ runId: "run-old", type: "old" }],
      sessionLogs: [{ ts: "2026-04-15T10:00:00.000Z", lvl: "INFO", src: "background", cat: "trace", msg: "old" }],
    } as any);
    vi.mocked(api.fetchTraceSessions).mockResolvedValue([
      {
        sessionId: "other-session",
        startTime: 100,
        endTime: 200,
        query: "Objective: test",
        startUrl: "https://example.com",
        outcome: "completed",
        turnCount: 2,
        summary: "done",
        metrics: null,
      },
    ] as any);

    await act(async () => {
      root.render(<HookHarness />);
    });
    await waitFor(() => {
      expect(useStore.getState().currentSessionId).toBeNull();
      expect(useStore.getState().currentEntries).toEqual([]);
      expect(useStore.getState().currentRunEvents).toEqual([]);
      expect(useStore.getState().sessionLogs).toEqual([]);
    });
  });

  test("loads entries and reports log-load failures as warnings", async () => {
    useStore.setState({ currentSessionId: "session-1" });
    vi.mocked(api.fetchTraceSessions).mockResolvedValue([
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
    ] as any);
    vi.mocked(api.fetchTraceEntries).mockResolvedValue([
      {
        sessionId: "session-1",
        turnNumber: 1,
        timestamp: 100,
        snapshot: {
          url: "https://example.com",
          title: "Example",
          elementCount: 3,
          visibleContentLength: 10,
          scrollY: 0,
        },
        elements: [],
        llmRequest: {
          model: "openai/gpt-5.4-mini:nitro",
          messageCount: 1,
          toolCount: 0,
          compressionLevel: "none",
        },
        llmResponse: {
          content: "ok",
          toolCalls: [],
          finishReason: "stop",
          usage: null,
          durationMs: 100,
        },
        toolExecutions: [],
        events: [],
        progressState: { stagnantTurns: 0, signal: null },
      },
    ] as any);
    vi.mocked(api.fetchRunTraceEvents).mockResolvedValue([
      {
        runId: "run-1",
        ts: "2026-04-15T10:00:00.000Z",
        type: "tab_coordination_state",
        data: { action: "initialized", primaryTabId: 10 },
      },
    ] as any);
    vi.mocked(api.fetchSessionLogs).mockRejectedValue(new Error("HTTP 500"));

    await act(async () => {
      root.render(<HookHarness />);
    });
    await waitFor(() => {
      expect(useStore.getState().currentEntries).toHaveLength(1);
      expect(useStore.getState().currentRunEvents).toEqual([]);
      expect(useStore.getState().sessionLogs).toEqual([]);
      expect(useStore.getState().logsWarning).toContain("Failed to load logs");
      expect(useStore.getState().logsWarning).toContain("HTTP 500");
    });
  });

  test("loads run events for the selected session run id", async () => {
    useStore.setState({ currentSessionId: "session-1" });
    vi.mocked(api.fetchTraceSessions).mockResolvedValue([
      {
        sessionId: "session-1",
        runId: "run-1",
        startTime: 100,
        endTime: 200,
        query: "Objective: test",
        startUrl: "https://example.com",
        outcome: "completed",
        turnCount: 2,
        summary: "done",
        metrics: null,
      },
    ] as any);
    vi.mocked(api.fetchTraceEntries).mockResolvedValue([]);
    vi.mocked(api.fetchRunTraceEvents).mockResolvedValue([
      {
        runId: "run-1",
        ts: "2026-04-15T10:00:00.000Z",
        type: "tab_coordination_state",
        data: { action: "initialized", primaryTabId: 10 },
      },
    ] as any);

    await act(async () => {
      root.render(<HookHarness />);
    });
    await waitFor(() => {
      expect(api.fetchRunTraceEvents).toHaveBeenCalledWith("run-1");
      expect(useStore.getState().currentRunEvents).toHaveLength(1);
    });
  });
});
