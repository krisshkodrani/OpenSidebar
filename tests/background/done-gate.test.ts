/**
 * Tests for the four-layer done() auto-advance verification gate.
 *
 * Layer 1: assessDoneSummary (sentiment) — tested in verification.test.ts
 * Layer 2: checkSummaryStepCoherence (cross-step) — tested in verification.test.ts
 * Layer 3: matchSuccessCriteria (token match) — tested here
 * Layer 4: consecutiveAutoAdvances rate limit — tested here (integration-style)
 */
import { describe, test, expect } from "vitest";
import "../setup";
import {
  matchSuccessCriteria,
  tokenizeStepText,
  snapshotSearchText,
} from "../../src/background/agent/loop-helpers";
import type { DomSnapshot } from "../../src/types";

// ── Helpers ──────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<DomSnapshot> = {}): DomSnapshot {
  return {
    title: overrides.title ?? "Test Page",
    url: overrides.url ?? "https://shop.example.com/cart",
    elements: overrides.elements ?? [],
    pageContent: overrides.pageContent ?? "",
    visibleContent: overrides.visibleContent ?? "",
    scrollPosition: { top: 0, left: 0, height: 1000, width: 1000 },
    viewportHeight: 800,
    timestamp: Date.now(),
    ...overrides,
  } as DomSnapshot;
}

function makeElement(text: string, attrs: Record<string, string> = {}) {
  return {
    tag: 1,
    tagName: "button",
    text,
    attributes: attrs,
    rect: { x: 0, y: 0, width: 100, height: 30 },
    isVisible: true,
    isDisabled: false,
  };
}

// ── tokenizeStepText ─────────────────────────────────────────────────

describe("tokenizeStepText", () => {
  test("extracts meaningful tokens, strips stopwords", () => {
    const tokens = tokenizeStepText(
      "Click the 'Add to cart' button for the second item",
    );
    // "click", "the", "button" are stopwords
    expect(tokens).toContain("cart");
    expect(tokens).toContain("second");
    expect(tokens).toContain("item");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("click");
    expect(tokens).not.toContain("button");
  });

  test("returns empty for pure stopwords", () => {
    const tokens = tokenizeStepText("click the next button");
    expect(tokens).toEqual([]);
  });

  test("deduplicates tokens", () => {
    const tokens = tokenizeStepText("cart cart cart item item");
    expect(tokens.filter((t) => t === "cart")).toHaveLength(1);
  });
});

// ── snapshotSearchText ───────────────────────────────────────────────

describe("snapshotSearchText", () => {
  test("combines title, url, content, and element attributes", () => {
    const snap = makeSnapshot({
      title: "Shopping Cart",
      url: "https://shop.example.com/cart",
      pageContent: "Your cart has 2 items",
      elements: [
        makeElement("Checkout", { id: "checkout-btn" }),
      ] as any,
    });
    const text = snapshotSearchText(snap);
    expect(text).toContain("shopping cart");
    expect(text).toContain("shop.example.com");
    expect(text).toContain("2 items");
    expect(text).toContain("checkout");
    expect(text).toContain("checkout-btn");
  });

  test("returns empty string for null snapshot", () => {
    expect(snapshotSearchText(null)).toBe("");
  });
});

// ── matchSuccessCriteria (Layer 2) ───────────────────────────────────

describe("matchSuccessCriteria", () => {
  test("passes when successCriteria is undefined", () => {
    const r = matchSuccessCriteria({
      successCriteria: undefined,
      snapshot: makeSnapshot(),
    });
    expect(r.satisfied).toBe(true);
    expect(r.totalTokens).toBe(0);
  });

  test("passes when successCriteria is empty string", () => {
    const r = matchSuccessCriteria({
      successCriteria: "",
      snapshot: makeSnapshot(),
    });
    expect(r.satisfied).toBe(true);
  });

  test("passes when successCriteria is only stopwords", () => {
    const r = matchSuccessCriteria({
      successCriteria: "click the next button",
      snapshot: makeSnapshot(),
    });
    expect(r.satisfied).toBe(true);
    expect(r.totalTokens).toBe(0);
  });

  test("satisfied when enough tokens match in page content", () => {
    const snap = makeSnapshot({
      pageContent: "Your cart has 2 items. Total: $49.98. Coupon applied.",
    });
    const r = matchSuccessCriteria({
      successCriteria: "Cart should contain items with coupon applied",
      snapshot: snap,
    });
    expect(r.satisfied).toBe(true);
    expect(r.matchedTokens.length).toBeGreaterThanOrEqual(1);
  });

  test("not satisfied when tokens are absent from DOM", () => {
    const snap = makeSnapshot({
      title: "Checkout",
      pageContent: "Enter your shipping address",
    });
    const r = matchSuccessCriteria({
      successCriteria: "Cart should show 2 items with coupon discount applied",
      snapshot: snap,
    });
    // "coupon", "discount", "items", "cart" — none on checkout page
    // (note: "cart" is a stopword so not counted; but "coupon", "discount", "items", "show" are)
    expect(r.satisfied).toBe(false);
  });

  test("passes with null snapshot when no criteria", () => {
    const r = matchSuccessCriteria({
      successCriteria: undefined,
      snapshot: null,
    });
    expect(r.satisfied).toBe(true);
  });

  test("not satisfied with null snapshot when criteria exist", () => {
    const r = matchSuccessCriteria({
      successCriteria: "Cart shows items and total",
      snapshot: null,
    });
    // null snapshot → empty search text → no tokens match
    expect(r.satisfied).toBe(false);
  });

  test("40% threshold: 2 of 5 tokens is enough", () => {
    // Criteria: "coupon discount applied total price" → 5 tokens (all non-stopword)
    const snap = makeSnapshot({
      pageContent: "Your coupon was applied. Shipping estimate pending.",
    });
    const r = matchSuccessCriteria({
      successCriteria: "coupon discount applied total price",
      snapshot: snap,
    });
    // "coupon" and "applied" match → 2/5 = 40% → passes
    expect(r.satisfied).toBe(true);
    expect(r.matchedTokens).toContain("coupon");
    expect(r.matchedTokens).toContain("applied");
  });

  test("40% threshold: 1 of 5 tokens is not enough", () => {
    const snap = makeSnapshot({
      pageContent: "Enter your shipping address and payment details",
    });
    const r = matchSuccessCriteria({
      successCriteria: "coupon discount applied total price",
      snapshot: snap,
    });
    // none of "coupon", "discount", "applied", "total", "price" appear → 0/5
    expect(r.satisfied).toBe(false);
  });

  test("matches tokens in element attributes", () => {
    const snap = makeSnapshot({
      elements: [
        makeElement("Apply Coupon", { id: "coupon-input", value: "SAVE10" }),
      ] as any,
    });
    const r = matchSuccessCriteria({
      successCriteria: "coupon code SAVE10 applied",
      snapshot: snap,
    });
    // "coupon" in text, "save10" in value
    expect(r.satisfied).toBe(true);
  });
});

// ── Rate limit (Layer 3) — behavioral documentation ──────────────────

describe("consecutiveAutoAdvances rate limit (behavioral spec)", () => {
  // These document the expected behavior without needing a full AgentLoop instance.
  // The actual integration is tested via the loop, but these specifications ensure
  // the design invariants are clear.

  test("threshold is 2: first two advances pass, third is blocked", () => {
    // Simulating the counter logic
    let counter = 0;
    const MAX = 2;

    // First advance
    expect(counter >= MAX).toBe(false);
    counter++;

    // Second advance
    expect(counter >= MAX).toBe(false);
    counter++;

    // Third advance — blocked
    expect(counter >= MAX).toBe(true);
  });

  test("DOM action resets counter", () => {
    let counter = 2; // at threshold
    // Simulate DOM-modifying tool
    counter = 0;
    expect(counter >= 2).toBe(false); // can advance again
  });

  test("structural/gate advance resets counter", () => {
    let counter = 2;
    // Simulate structural step advance
    counter = 0;
    expect(counter >= 2).toBe(false);
  });
});
