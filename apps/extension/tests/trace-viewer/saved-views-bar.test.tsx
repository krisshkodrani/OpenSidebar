import React from "react";
import { act } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import SavedViewsBar from "../../src/trace-viewer/components/traces/SavedViewsBar";
import { useStore } from "../../src/trace-viewer/store";

function resetStore() {
  useStore.setState((useStore as any).getInitialState(), true);
}

describe("SavedViewsBar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetStore();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  test("saves and reapplies the current filter set", async () => {
    useStore.getState().setFilter("outcome", "error");
    useStore.getState().setFilter("tier", "planner");
    const onFiltersChanged = vi.fn();

    await act(async () => {
      root.render(<SavedViewsBar onFiltersChanged={onFiltersChanged} />);
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Save Current View"),
    );
    expect(saveButton).toBeTruthy();

    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(useStore.getState().savedViews).toHaveLength(1);

    useStore.getState().setFilter("outcome", "all");
    useStore.getState().setFilter("tier", "all");

    const applyButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Error / Planner"),
    );
    expect(applyButton).toBeTruthy();

    await act(async () => {
      applyButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(useStore.getState().filters.outcome).toBe("error");
    expect(useStore.getState().filters.tier).toBe("planner");
    expect(onFiltersChanged).toHaveBeenCalled();
  });
});
