import React, { act } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import FilterBar from "../../src/trace-viewer/components/traces/FilterBar";
import { useStore } from "../../src/trace-viewer/store";
import { isoDayOffset } from "../../src/trace-viewer/utils";

function resetStore() {
  useStore.setState((useStore as any).getInitialState(), true);
}

describe("FilterBar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetStore();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  async function render() {
    await act(async () => {
      root.render(<FilterBar onFiltersChanged={vi.fn()} />);
    });
  }

  test("uses theme-aware surfaces so the bar is legible in dark mode", async () => {
    // Regression: selects, the domain input, and the date-preset buttons
    // hardcoded `bg-white` while text used the theme's near-white --trace-text,
    // making the whole filter bar unreadable when the viewer is in dark mode.
    await render();

    expect(container.querySelectorAll("[class*='bg-white']").length).toBe(0);

    const surfaces = container.querySelectorAll("[class*='bg-trace-surface']");
    expect(surfaces.length).toBeGreaterThan(0);

    // Every interactive control resolves its background to a theme variable.
    container
      .querySelectorAll("select, input, button")
      .forEach((el) => {
        expect(el.className).not.toContain("bg-white");
      });
  });

  test("shows Clear filters when only the date window changed", async () => {
    // Regression for the divergent active-filter logic: a date-window change
    // must surface the Clear affordance (FilterBar already did; the shared
    // helper keeps FleetOverview consistent).
    await render();
    expect(
      Array.from(container.querySelectorAll("button")).some((b) =>
        b.textContent?.includes("Clear filters"),
      ),
    ).toBe(false);

    await act(async () => {
      useStore.getState().setFilter("from", isoDayOffset(0));
    });

    expect(
      Array.from(container.querySelectorAll("button")).some((b) =>
        b.textContent?.includes("Clear filters"),
      ),
    ).toBe(true);
  });
});
