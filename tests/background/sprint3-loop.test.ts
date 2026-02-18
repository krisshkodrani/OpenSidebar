/**
 * Sprint 3 Loop Tests
 * Tests for: outcome-based dead-end detection (normalizeOutcome, constants)
 */

import { describe, test, expect } from "bun:test";
import { DEAD_END_DETECTION } from "../../src/background/agent/constants";

// ─── Outcome Normalization (mirrors loop.ts normalizeOutcome) ──────────────

// Re-implement normalizeOutcome for unit testing since it's module-level in loop.ts
function normalizeOutcome(result: string): string {
  return result
    .replace(/\b\d+\b/g, "N")
    .replace(/\[N\]/g, "[N]")
    .replace(/tag N/g, "tag N")
    .slice(0, 120)
    .trim();
}

describe("normalizeOutcome", () => {
  test("strips element IDs (numbers)", () => {
    const result = normalizeOutcome("No element with tag [42]");
    expect(result).toBe("No element with tag [N]");
  });

  test("normalizes different element IDs to same fingerprint", () => {
    const a = normalizeOutcome("No element with tag [12]");
    const b = normalizeOutcome("No element with tag [99]");
    expect(a).toBe(b);
  });

  test("strips numeric values throughout", () => {
    const result = normalizeOutcome("Clicked [5] button \"Submit\" at position 100,200");
    expect(result).toBe("Clicked [N] button \"Submit\" at position N,N");
  });

  test("caps length at 120 characters", () => {
    const longResult = "Error: ".padEnd(200, "x");
    const normalized = normalizeOutcome(longResult);
    expect(normalized.length).toBeLessThanOrEqual(120);
  });

  test("preserves text structure for matching", () => {
    const result = normalizeOutcome("Click intercepted! Element [3] is covered by overlay [7]");
    expect(result).toContain("Click intercepted");
    expect(result).toContain("covered by overlay");
  });

  test("different outcomes normalize differently", () => {
    const a = normalizeOutcome("No element with tag [42]");
    const b = normalizeOutcome("Click intercepted! Element [3] is covered by overlay [7]");
    expect(a).not.toBe(b);
  });

  test("empty string produces empty fingerprint", () => {
    expect(normalizeOutcome("")).toBe("");
  });
});

describe("DEAD_END_DETECTION constants", () => {
  test("window size is 6", () => {
    expect(DEAD_END_DETECTION.WINDOW).toBe(6);
  });

  test("nudge threshold is 3", () => {
    expect(DEAD_END_DETECTION.NUDGE_THRESHOLD).toBe(3);
  });

  test("pivot threshold is 5", () => {
    expect(DEAD_END_DETECTION.PIVOT_THRESHOLD).toBe(5);
  });

  test("pivot threshold > nudge threshold", () => {
    expect(DEAD_END_DETECTION.PIVOT_THRESHOLD).toBeGreaterThan(DEAD_END_DETECTION.NUDGE_THRESHOLD);
  });
});

describe("dead-end detection logic", () => {
  // Simulate the dead-end detection logic from loop.ts
  function simulateDeadEndDetection(outcomes: string[]): "none" | "nudge" | "pivot" {
    const recentOutcomes: string[] = [];
    let lastResult: "none" | "nudge" | "pivot" = "none";

    for (const outcome of outcomes) {
      const fingerprint = normalizeOutcome(outcome);
      recentOutcomes.push(fingerprint);
      if (recentOutcomes.length > DEAD_END_DETECTION.WINDOW) recentOutcomes.shift();

      const lastN = recentOutcomes.slice(-DEAD_END_DETECTION.PIVOT_THRESHOLD);
      const allSame = lastN.length >= DEAD_END_DETECTION.NUDGE_THRESHOLD &&
        lastN.every(o => o === lastN[0]);

      if (allSame && lastN.length >= DEAD_END_DETECTION.PIVOT_THRESHOLD) {
        lastResult = "pivot";
      } else if (allSame) {
        lastResult = "nudge";
      } else {
        lastResult = "none";
      }
    }
    return lastResult;
  }

  test("nudge injected after 3 identical outcomes", () => {
    const outcomes = [
      "No element with tag [1]",
      "No element with tag [2]",
      "No element with tag [3]",
    ];
    expect(simulateDeadEndDetection(outcomes)).toBe("nudge");
  });

  test("pivot forced after 5 identical outcomes", () => {
    const outcomes = [
      "No element with tag [1]",
      "No element with tag [2]",
      "No element with tag [3]",
      "No element with tag [4]",
      "No element with tag [5]",
    ];
    expect(simulateDeadEndDetection(outcomes)).toBe("pivot");
  });

  test("different outcomes don't trigger detection", () => {
    const outcomes = [
      "Clicked [1] button",
      "No element with tag [2]",
      "Scrolled down by 500px",
      "Clicked [5] link",
    ];
    expect(simulateDeadEndDetection(outcomes)).toBe("none");
  });

  test("window slides — old outcomes evicted", () => {
    // 6 identical outcomes (fills window) then a different one
    const outcomes = [
      "Error: timeout",
      "Error: timeout",
      "Error: timeout",
      "Error: timeout",
      "Error: timeout",
      "Error: timeout",
      "Clicked [1] button",
    ];
    expect(simulateDeadEndDetection(outcomes)).toBe("none");
  });

  test("3 identical outcomes after different ones triggers nudge", () => {
    // First 2 are different, then 3 identical — window is only 3 items deep
    const outcomes = [
      "Click intercepted! Element [5] is covered by overlay [10]",
      "Click intercepted! Element [3] is covered by overlay [7]",
      "Click intercepted! Element [9] is covered by overlay [12]",
    ];
    // All 3 normalize to same "Click intercepted" pattern
    expect(simulateDeadEndDetection(outcomes)).toBe("nudge");
  });
});
