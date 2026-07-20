import React, { act } from "react";
import { beforeEach, afterEach, describe, expect, test } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";

import ViewerHeader from "../../src/trace-viewer/components/ViewerHeader";
import { useStore } from "../../src/trace-viewer/store";
import { TRACE_SESSION_SEARCH_LIMIT } from "../../src/trace-viewer/api";
import type { TraceSession } from "../../src/types/traces";

function resetStore() {
  useStore.setState((useStore as any).getInitialState(), true);
}

function sess(overrides: Partial<TraceSession>): TraceSession {
  return {
    sessionId: "s",
    startTime: 1,
    endTime: 2,
    query: "Objective: do a thing",
    startUrl: "https://x",
    outcome: "completed",
    turnCount: 2,
    summary: "",
    metrics: null,
    ...overrides,
  } as TraceSession;
}

// The header now owns the top-level tabs and the fleet summary stats (moved
// from the retired TopLevelTabs strip and FleetOverview bar).
describe("ViewerHeader", () => {
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

  function render() {
    act(() => {
      root.render(<ViewerHeader />);
    });
  }

  test("only the Runs tab shows a count badge; standalone sessions count as rows", async () => {
    useStore.getState().setSessions([
      sess({ sessionId: "session-1", runId: "run-1", outcome: "completed" }),
      sess({ sessionId: "session-2", runId: "run-1", outcome: "error" }),
      sess({ sessionId: "session-3" }), // standalone → its own Runs row
    ] as TraceSession[]);
    render();

    const text = container.textContent ?? "";
    expect(text).toContain("Runs (2)"); // 1 group + 1 standalone
    expect(text).toContain("Analytics");
    expect(text).not.toContain("Analytics (");
  });

  test("marks the Runs count as capped at the loaded search limit", async () => {
    const sessions = Array.from({ length: TRACE_SESSION_SEARCH_LIMIT }, (_, i) =>
      sess({ sessionId: `session-${i}`, runId: "run-1" }),
    );
    useStore.getState().setSessions(sessions as TraceSession[]);
    render();

    expect(container.textContent).toContain("Runs (1+)");
  });

  test("shows fleet summary stats and hides them during session detail", async () => {
    useStore.getState().setSessions([
      sess({
        sessionId: "session-1",
        outcome: "completed",
        turnCount: 4,
        metrics: { totalCost: 0.5 } as never,
      }),
      sess({
        sessionId: "session-2",
        outcome: "error",
        turnCount: 2,
        metrics: { totalCost: 0.25 } as never,
      }),
    ] as TraceSession[]);
    render();

    let text = container.textContent ?? "";
    expect(text).toContain("Traces:");
    expect(text).toContain("Success:");
    expect(text).toContain("50%");
    expect(text).toContain("Avg turns:");
    expect(text).toContain("3.0");

    act(() => {
      useStore.getState().setCurrentSessionId("session-1");
    });
    text = container.textContent ?? "";
    expect(text).not.toContain("Success:");
  });

  test("selecting a tab from session detail deselects the session", async () => {
    useStore.getState().setSessions([
      sess({ sessionId: "session-1", runId: "run-1" }),
    ] as TraceSession[]);
    useStore.getState().setCurrentSessionId("session-1");
    render();

    const analyticsTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Analytics",
    );
    expect(analyticsTab).toBeTruthy();
    act(() => {
      analyticsTab!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(useStore.getState().currentSessionId).toBeNull();
    expect(useStore.getState().activeTopLevelView).toBe("analytics");
  });

  test("cycles the theme from the header button", async () => {
    render();
    const themeButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.getAttribute("aria-label")?.startsWith("Current theme"),
    );
    expect(themeButton).toBeTruthy();
    expect(useStore.getState().viewerTheme).toBe("system");
    act(() => {
      themeButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useStore.getState().viewerTheme).toBe("light");
  });
});
