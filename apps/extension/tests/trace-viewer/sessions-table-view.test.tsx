import React from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import { useStore } from "../../src/trace-viewer/store";
import SessionsTableView from "../../src/trace-viewer/components/traces/SessionsTableView";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 44,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        start: index * 44,
      })),
    measureElement: () => undefined,
  }),
}));

function resetStore() {
  useStore.setState((useStore as any).getInitialState(), true);
}

describe("SessionsTableView", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetStore();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  test("renders models from metrics.modelBreakdown fallback and selects a row", async () => {
    useStore.setState({
      sessions: [
        {
          sessionId: "session-1",
          startTime: Date.UTC(2026, 3, 15, 9, 30, 0),
          endTime: Date.UTC(2026, 3, 15, 9, 31, 0),
          query: "Objective: Verify model fallback",
          startUrl: "https://example.com",
          outcome: "completed",
          turnCount: 3,
          summary: "done",
          metrics: {
            totalCost: 0,
            modelBreakdown: {
              "openai/gpt-5.4-mini:nitro": { calls: 3 },
            },
          },
        },
      ],
      tracesLoading: false,
      tableSort: { column: "startTime", direction: "desc" },
    } as any);

    const onSelect = vi.fn();
    await act(async () => {
      root.render(<SessionsTableView onSelect={onSelect} />);
    });

    expect(container.textContent).toContain("Verify model fallback");
    expect(container.textContent).toContain("gpt-5.4-mini:nitro");

    const row = container.querySelector('[data-index="0"] > button');
    expect(row).not.toBeNull();

    await act(async () => {
      row!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSelect).toHaveBeenCalledWith("session-1");
  });
});
