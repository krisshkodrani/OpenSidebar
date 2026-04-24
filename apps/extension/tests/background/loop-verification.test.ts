import { describe, it, expect } from "vitest";
import { formatActionEffect } from "../../src/background/agent/loop";
import { ActionEffect } from "../../src/background/agent/stagnation";

/** Helper to build an ActionEffect with overrides */
function makeEffect(overrides?: Partial<ActionEffect>): ActionEffect {
  return {
    deltaPercent: 0,
    urlChanged: false,
    currentUrl: "https://example.com",
    elementsAdded: 0,
    elementsRemoved: 0,
    prevCount: 10,
    currentCount: 10,
    ...overrides,
  };
}

describe("formatActionEffect", () => {
  it("returns no-change message when delta is below threshold and URL unchanged", () => {
    const msg = formatActionEffect(makeEffect({ deltaPercent: 0.01 }));
    expect(msg).toBe(
      "[Action effect: No observable DOM change — page state appears unchanged.]",
    );
  });

  it("returns no-change message for exact zero delta", () => {
    const msg = formatActionEffect(makeEffect({ deltaPercent: 0 }));
    expect(msg).toBe(
      "[Action effect: No observable DOM change — page state appears unchanged.]",
    );
  });

  it("returns formatted message when delta is above threshold", () => {
    const msg = formatActionEffect(
      makeEffect({
        deltaPercent: 0.23,
        elementsAdded: 4,
        elementsRemoved: 2,
      }),
    );
    expect(msg).toBe("[Action effect: 23% elements changed, +4 new, -2 removed]");
  });

  it("includes URL changed when URL changed", () => {
    const msg = formatActionEffect(
      makeEffect({
        deltaPercent: 0.1,
        urlChanged: true,
        elementsAdded: 3,
      }),
    );
    expect(msg).toContain("URL changed");
    expect(msg).toContain("10% elements changed");
    expect(msg).toContain("+3 new");
  });

  it("returns change message even for low delta when URL changed", () => {
    // Even though deltaPercent < 0.02, URL change means we show a change message
    const msg = formatActionEffect(
      makeEffect({
        deltaPercent: 0.01,
        urlChanged: true,
      }),
    );
    expect(msg).not.toContain("No observable DOM change");
    expect(msg).toContain("URL changed");
  });

  it("omits added/removed counts when zero", () => {
    const msg = formatActionEffect(
      makeEffect({
        deltaPercent: 0.15,
        elementsAdded: 0,
        elementsRemoved: 0,
      }),
    );
    expect(msg).toBe("[Action effect: 15% elements changed]");
    expect(msg).not.toContain("+");
    expect(msg).not.toContain("-");
  });

  it("rounds delta percentage to integer", () => {
    const msg = formatActionEffect(
      makeEffect({
        deltaPercent: 0.337,
        elementsAdded: 1,
      }),
    );
    expect(msg).toContain("34% elements changed");
  });

  it("handles 100% delta (full page swap)", () => {
    const msg = formatActionEffect(
      makeEffect({
        deltaPercent: 1.0,
        elementsAdded: 20,
        elementsRemoved: 15,
      }),
    );
    expect(msg).toContain("100% elements changed");
  });
});
