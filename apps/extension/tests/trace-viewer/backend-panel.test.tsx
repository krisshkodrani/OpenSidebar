import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import BackendPanel from "../../src/trace-viewer/components/BackendPanel";

const mockFetchBackendHealth = vi.fn();
const mockFetchDurableRuns = vi.fn();
const mockFetchDurableRunDetail = vi.fn();
const mockFetchMemoryList = vi.fn();
const mockFetchMemorySearch = vi.fn();
const mockFetchMemoryDetail = vi.fn();
const mockFetchScheduledTasks = vi.fn();
const mockDeleteMemory = vi.fn();
const mockDeleteScheduledTask = vi.fn();
const mockRequestDurableRunResume = vi.fn();
const mockRequestDurableRunStop = vi.fn();

vi.mock("../../src/trace-viewer/api", () => ({
  fetchBackendHealth: () => mockFetchBackendHealth(),
  fetchDurableRuns: (...args: unknown[]) => mockFetchDurableRuns(...args),
  fetchDurableRunDetail: (...args: unknown[]) =>
    mockFetchDurableRunDetail(...args),
  fetchMemoryList: () => mockFetchMemoryList(),
  fetchMemorySearch: () => mockFetchMemorySearch(),
  fetchMemoryDetail: () => mockFetchMemoryDetail(),
  fetchScheduledTasks: () => mockFetchScheduledTasks(),
  deleteMemory: (...args: unknown[]) => mockDeleteMemory(...args),
  deleteScheduledTask: (...args: unknown[]) => mockDeleteScheduledTask(...args),
  requestDurableRunResume: (...args: unknown[]) =>
    mockRequestDurableRunResume(...args),
  requestDurableRunStop: (...args: unknown[]) => mockRequestDurableRunStop(...args),
}));

vi.mock("../../src/trace-viewer/components/LoadingSpinner", () => ({
  default: ({ message }: { message: string }) => <div>{message}</div>,
}));

vi.mock("../../src/trace-viewer/components/ErrorBanner", () => ({
  default: ({ message }: { message: string }) => <div>{message}</div>,
}));

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitFor(check: () => void, attempts = 10) {
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

describe("trace-viewer BackendPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mockFetchBackendHealth.mockReset();
    mockFetchDurableRuns.mockReset();
    mockFetchDurableRunDetail.mockReset();
    mockFetchMemoryList.mockReset();
    mockFetchMemorySearch.mockReset();
    mockFetchMemoryDetail.mockReset();
    mockFetchScheduledTasks.mockReset();
    mockDeleteMemory.mockReset();
    mockDeleteScheduledTask.mockReset();
    mockRequestDurableRunResume.mockReset();
    mockRequestDurableRunStop.mockReset();

    mockFetchBackendHealth.mockResolvedValue({
      status: "ok",
      uptime: 42,
      memoryConnected: true,
      memoryStats: { pageCount: 3 },
      pendingTasks: 1,
    });
    mockFetchMemoryList.mockResolvedValue([]);
    mockFetchMemorySearch.mockResolvedValue([]);
    mockFetchScheduledTasks.mockResolvedValue([]);
    mockFetchDurableRuns.mockResolvedValue([
      {
        id: "run-1",
        clientRunId: "task-1",
        workspaceId: "ws-1",
        query: "Compare the recovered job findings",
        status: "running",
        createdAt: Date.now() - 10_000,
        updatedAt: Date.now(),
        finishedAt: null,
        currentNodeId: "compare-1",
        nodeCounts: {
          pending: 0,
          running: 1,
          completed: 2,
          failed: 0,
          skipped: 0,
        },
        pendingInteraction: null,
        progressSummary: {
          completedPhases: [
            "Reviewed Frontend Tech Lead",
            "Reviewed Senior Frontend Engineer",
          ],
          outstandingQuestions: [],
          reviewedItemCount: 2,
          extractedFactCount: 3,
        },
        lastKnownResumeSafe: true,
        lastResumeSafetyCheckedAt: Date.now(),
        lastKnownResumeReason: "Live workspace tab available.",
        lastResumeSource: "backend",
        resumeRequestedAt: null,
        stopRequestedAt: null,
      },
    ]);
    mockFetchDurableRunDetail.mockResolvedValue({
      run: {
        id: "run-1",
        clientRunId: "task-1",
        workspaceId: "ws-1",
        query: "Compare the recovered job findings",
        status: "running",
        createdAt: Date.now() - 10_000,
        updatedAt: Date.now(),
        finishedAt: null,
        rootTabId: 101,
        rootTabUrl: null,
        turnNumber: 1,
        terminationReason: null,
        checkpointSummary: { currentIndex: 0 },
        sessionMetrics: {},
        budget: {},
        resumeStateVersion: 1,
        nodeCounts: {
          pending: 0,
          running: 1,
          completed: 2,
          failed: 0,
          skipped: 0,
        },
        resumeRequestedAt: null,
        resumeRequestedReason: null,
        stopRequestedAt: null,
        stopRequestedReason: null,
        lastKnownResumeSafe: true,
        lastResumeSafetyCheckedAt: Date.now(),
        lastKnownResumeReason: "Live workspace tab available.",
        lastResumeSource: "backend",
      },
      nodes: [
        {
          nodeId: "compare-1",
          description: "Recommend the single best match",
          successCriteria: "Return the strongest match and why",
          status: "running",
          retries: 0,
          result: null,
          error: null,
        },
      ],
      progress: [
        {
          key: "completed-phases",
          kind: "completed-phase-list",
          payload: [
            "Reviewed Frontend Tech Lead",
            "Reviewed Senior Frontend Engineer",
          ],
          updatedAt: Date.now(),
        },
        {
          key: "extracted-facts",
          kind: "extracted-fact-map",
          payload: {
            "Senior Frontend Engineer":
              "fully remote, React/TypeScript, hands-on individual contributor role",
            "User preference":
              "prefers hands-on frontend work over management responsibilities",
          },
          updatedAt: Date.now(),
        },
      ],
      pendingInteraction: null,
      recentSideEffects: [
        {
          id: "effect-1",
          nodeId: "compare-1",
          toolName: "read_page",
          result: "Read the current page before synthesizing from recovered findings.",
          timestamp: Date.now(),
        },
      ],
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  test("renders structured progress and recent side effects in durable run detail", async () => {
    await act(async () => {
      root.render(<BackendPanel />);
    });

    await flushAsyncWork();

    const runsButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim().toLowerCase() === "runs",
    ) as HTMLButtonElement | undefined;

    expect(runsButton).toBeTruthy();

    await act(async () => {
      runsButton?.click();
    });

    await waitFor(() => {
      expect(container.textContent).toContain("Structured Progress");
      expect(container.textContent).toContain("completed-phases");
      expect(container.textContent).toContain("Senior Frontend Engineer");
      expect(container.textContent).toContain("User preference");
      expect(container.textContent).toContain("Recent Side Effects");
      expect(container.textContent).toContain("read_page");
    });
  });
});
