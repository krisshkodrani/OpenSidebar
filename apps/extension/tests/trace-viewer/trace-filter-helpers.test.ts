import { describe, expect, test } from "vitest";
import {
  defaultTraceFilters,
  hasActiveTraceFilters,
  isDefaultTraceWindow,
  isoDayOffset,
  todayIso,
} from "../../src/trace-viewer/utils";

describe("trace filter helpers", () => {
  test("default filters are the last-7-day window with no other filters", () => {
    const def = defaultTraceFilters();
    expect(def).toEqual({
      outcome: "all",
      day: "all",
      from: isoDayOffset(6),
      to: todayIso(),
      domain: "",
      model: "all",
      skill: "all",
      runId: "",
      adjudication: "all",
      needsReview: "off",
    });
    expect(hasActiveTraceFilters(def)).toBe(false);
    expect(isDefaultTraceWindow(def)).toBe(true);
  });

  test("a changed date window counts as an active filter", () => {
    // Regression: the FleetOverview summary previously ignored from/to, so a
    // date-preset change left its "Clear filters" affordance hidden while the
    // FilterBar showed one — the two surfaces disagreed.
    const today = todayIso();
    expect(
      hasActiveTraceFilters({ ...defaultTraceFilters(), from: isoDayOffset(0), to: today }),
    ).toBe(true);
    expect(
      hasActiveTraceFilters({ ...defaultTraceFilters(), to: isoDayOffset(1) }),
    ).toBe(true);
    expect(
      hasActiveTraceFilters({ ...defaultTraceFilters(), from: "" }),
    ).toBe(true);
  });

  test("each non-default field flips the helper to active", () => {
    for (const override of [
      { outcome: "error" },
      { day: "2026-06-01" },
      { domain: "example.com" },
      { model: "openai/gpt-5.4-mini" },
      { skill: "search-flow" },
      { runId: "run-123" },
      { needsReview: "on" },
    ]) {
      expect(
        hasActiveTraceFilters({ ...defaultTraceFilters(), ...override }),
      ).toBe(true);
    }
  });
});
