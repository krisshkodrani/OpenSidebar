import React from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import { useStore } from "../../src/trace-viewer/store";
import RunsTableView from "../../src/trace-viewer/components/traces/RunsTableView";

function resetStore() {
  useStore.setState((useStore as any).getInitialState(), true);
}

describe("RunsTableView", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetStore();
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

  test("renders run groups and selects a child session", async () => {
    useStore.getState().setSessions([
      {
        sessionId: "session-1",
        runId: "run-12345678",
        startTime: Date.UTC(2026, 3, 15, 9, 30, 0),
        endTime: Date.UTC(2026, 3, 15, 9, 31, 0),
        query: "Objective: first step",
        startUrl: "https://example.com/one",
        outcome: "completed",
        turnCount: 3,
        summary: "done",
        metrics: {
          totalCost: 0.1,
          modelBreakdown: { "openai/gpt-5.4-mini:nitro": { calls: 3 } },
        },
      },
      {
        sessionId: "session-2",
        runId: "run-12345678",
        startTime: Date.UTC(2026, 3, 15, 9, 31, 30),
        endTime: Date.UTC(2026, 3, 15, 9, 32, 0),
        query: "Objective: second step",
        startUrl: "https://example.com/two",
        outcome: "error",
        turnCount: 2,
        summary: "failed",
        metrics: {
          totalCost: 0.2,
          modelBreakdown: { "openai/gpt-5.4": { calls: 2 } },
        },
      },
    ] as any);

    const onSelectSession = vi.fn();
    await act(async () => {
      root.render(<RunsTableView onSelectSession={onSelectSession} />);
    });

    expect(container.textContent).toContain("run-1234");
    expect(container.textContent).toContain("2 traces");
    expect(container.textContent).toContain("5 turns");

    const buttons = Array.from(container.querySelectorAll("button"));
    const runButton = buttons.find((button) =>
      button.textContent?.includes("run-1234"),
    );
    expect(runButton).toBeTruthy();

    await act(async () => {
      runButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const interactiveElements = [
      ...Array.from(container.querySelectorAll("button")),
      ...Array.from(container.querySelectorAll('[role="button"]')),
    ];
    const childButton = interactiveElements.find((element) =>
      element.textContent?.includes("second step"),
    );
    expect(childButton).toBeTruthy();

    await act(async () => {
      childButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSelectSession).toHaveBeenCalledWith("session-2");
  });

  test("shows standalone sessions as top-level rows when no run groups exist", async () => {
    const onSelectSession = vi.fn();
    await act(async () => {
      useStore.getState().setSessions([
        {
          sessionId: "session-without-run",
          startTime: Date.UTC(2026, 3, 15, 9, 30, 0),
          endTime: Date.UTC(2026, 3, 15, 9, 31, 0),
          query: "Objective: inspect standalone trace",
          startUrl: "https://example.com",
          outcome: "completed",
          turnCount: 1,
          summary: "done",
          metrics: null,
        },
      ] as any);
      useStore.getState().setActiveTopLevelView("runs");
    });

    await act(async () => {
      root.render(<RunsTableView onSelectSession={onSelectSession} />);
    });

    // The former flat Traces table folded into Runs: run-less sessions render
    // as their own rows and remain directly openable.
    expect(container.textContent).toContain("inspect standalone trace");
    const row = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("inspect standalone trace"),
    );
    expect(row).toBeTruthy();
    await act(async () => {
      row!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSelectSession).toHaveBeenCalledWith("session-without-run");
  });
});
