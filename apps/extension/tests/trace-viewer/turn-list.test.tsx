import React, { act } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";

// TurnCard renders the full turn detail; stub it so this test stays focused on
// the focus/search interaction in TurnList.
vi.mock("../../src/trace-viewer/components/traces/TurnCard", () => ({
  default: ({ entry }: { entry: { turnNumber: number } }) => (
    <div>turn-{entry.turnNumber}</div>
  ),
}));

import TurnList from "../../src/trace-viewer/components/traces/TurnList";
import { useStore } from "../../src/trace-viewer/store";

function resetStore() {
  useStore.setState((useStore as any).getInitialState(), true);
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("TurnList deep-link focus", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetStore();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  test("clears an active search that hides the targeted turn", async () => {
    // Regression: navigating to a turn filtered out by the search box cleared the
    // focus request without scrolling, so "Open turn N" deep-links silently did
    // nothing while a search was active.
    useStore.setState({
      currentSessionId: "s1",
      currentEntries: [
        { turnNumber: 1, llmResponse: { content: "alpha findings" } },
        { turnNumber: 2, llmResponse: { content: "beta findings" } },
      ],
      searchQuery: "alpha",
    } as any);

    await act(async () => {
      root.render(<TurnList />);
    });

    // Sanity: "alpha" matches turn 1 but not turn 2 (so turn 2 is hidden).
    expect(useStore.getState().searchQuery).toBe("alpha");

    await act(async () => {
      useStore.getState().navigateToTurn(2);
    });
    await flush();

    // The search was cleared so the deep-linked turn can become visible.
    // (The list is virtualized; happy-dom has no layout, so we assert the
    // store-level behavior that drives the scroll rather than rendered rows.)
    expect(useStore.getState().searchQuery).toBe("");
  });

  test("does not clear the search for a turn that does not exist", async () => {
    useStore.setState({
      currentSessionId: "s1",
      currentEntries: [
        { turnNumber: 1, llmResponse: { content: "alpha findings" } },
      ],
      searchQuery: "alpha",
    } as any);

    await act(async () => {
      root.render(<TurnList />);
    });

    await act(async () => {
      useStore.getState().navigateToTurn(99);
    });
    await flush();

    // Turn 99 is genuinely absent; the search is left intact and the request is
    // not left stuck pending.
    expect(useStore.getState().searchQuery).toBe("alpha");
    expect(useStore.getState().focusTurnRequest).toBeNull();
  });
});
