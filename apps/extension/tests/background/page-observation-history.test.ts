import { describe, expect, test } from "vitest";
import type { DomSnapshot } from "../../src/types";
import { PageObservationHistory } from "../../src/background/agent/page-observation-history";

function snapshot(pageContent: string): DomSnapshot {
  return {
    url: "https://example.test/requests/17",
    title: "Request 17",
    pageContent,
    elements: [],
    viewport: { width: 1000, height: 800 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 800 },
  };
}

describe("page observation history", () => {
  test("preserves before/conflict/after values independently of later snapshot mutation", () => {
    const history = new PageObservationHistory();
    const before = snapshot("Cost center Platform. Estimated cost in EUR.");
    history.record(before);
    history.record(before);
    before.pageContent = "Changed after capture";
    history.record(snapshot("Another editor changed cost center to Research."));
    history.record(snapshot("Draft saved. Amount 740. Cost center Research."));
    const values = history.toArray().map((entry) => JSON.parse(entry).content);
    expect(values).toEqual([
      "Cost center Platform. Estimated cost in EUR.",
      "Another editor changed cost center to Research.",
      "Draft saved. Amount 740. Cost center Research.",
    ]);
    expect(history.toArray().join()).not.toMatch(/tabId|chrome\.storage/);
  });

  test("bounds retained page data and always keeps the newest observation", () => {
    const history = new PageObservationHistory();
    for (let i = 0; i < 30; i++) history.record(snapshot(`${i}: ${"x".repeat(8000)}`));
    const entries = history.toArray();
    expect(entries.length).toBeLessThanOrEqual(12);
    expect(entries.join("").length).toBeLessThanOrEqual(24_000);
    expect(JSON.parse(entries.at(-1)!).content).toMatch(/^29:/);
    entries.length = 0;
    expect(history.toArray().length).toBeGreaterThan(0);
    history.clear();
    expect(history.toArray()).toEqual([]);
  });

  test("escaped control characters cannot evict the newest observation by exceeding its budget", () => {
    const history = new PageObservationHistory();
    history.record(snapshot("\u0001".repeat(4000)));
    expect(history.toArray()).toHaveLength(1);
    expect(history.toArray()[0].length).toBeLessThanOrEqual(8000);
    expect(history.toArray()[0]).toContain("[Page observation truncated]");
  });
});
