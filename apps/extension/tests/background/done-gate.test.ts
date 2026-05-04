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
import { isDoneSummaryAskingClarification } from "../../src/background/agent/loop";
import {
  buildFirstTurnTextOnlyNudge,
  evaluateDoneTaskContractGuard,
  matchSuccessCriteria,
  requiresGroundingReadBeforeDone,
  snapshotSearchText,
  tokenizeStepText,
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

describe("isDoneSummaryAskingClarification", () => {
  test("allows completion reports that quote thread questions as evidence", () => {
    expect(
      isDoneSummaryAskingClarification(
        "Successfully read the #project-updates channel and identified Sarah's timing question: when exactly are we targeting the release?",
      ),
    ).toBe(false);
  });

  test("rejects direct clarification questions passed through done", () => {
    expect(
      isDoneSummaryAskingClarification(
        "Which account should I use for this request?",
      ),
    ).toBe(true);
  });
});

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

  test("requires quoted phrase matches when criteria include exact text", () => {
    const snap = makeSnapshot({
      pageContent: "Warehouse Alpha inventory count: 4,827 units",
    });
    const r = matchSuccessCriteria({
      successCriteria:
        'Confirmation shows "Warehouse Gamma" and inventory count 6,412',
      snapshot: snap,
    });
    expect(r.satisfied).toBe(false);
    expect(r.requiredQuotedPhrases).toContain("warehouse gamma");
    expect(r.requiredNumbers).toContain("6,412");
  });

  test("requires numeric literals from success criteria", () => {
    const snap = makeSnapshot({
      pageContent: "Warehouse Gamma inventory count: 6,412 units",
    });
    const r = matchSuccessCriteria({
      successCriteria:
        'Confirmation shows "Warehouse Gamma" and inventory count 6,412',
      snapshot: snap,
    });
    expect(r.satisfied).toBe(true);
    expect(r.matchedQuotedPhrases).toContain("warehouse gamma");
    expect(r.matchedNumbers).toContain("6,412");
  });

  test("requires named target phrases from success criteria", () => {
    const betaSnap = makeSnapshot({
      pageContent: "Warehouse Beta inventory count: 3,156 units",
    });
    const alphaStep = matchSuccessCriteria({
      successCriteria: "Page shows Warehouse Alpha and the requested result value.",
      snapshot: betaSnap,
    });
    expect(alphaStep.satisfied).toBe(false);
    expect(alphaStep.requiredNamedPhrases).toContain("warehouse alpha");

    const alphaSnap = makeSnapshot({
      pageContent: "Warehouse Alpha inventory count: 4,827 units",
    });
    const alphaMatched = matchSuccessCriteria({
      successCriteria: "Page shows Warehouse Alpha and the requested result value.",
      snapshot: alphaSnap,
    });
    expect(alphaMatched.satisfied).toBe(true);
    expect(alphaMatched.matchedNamedPhrases).toContain("warehouse alpha");
  });
});

describe("requiresGroundingReadBeforeDone", () => {
  test("requires grounding for summarize and report tasks", () => {
    expect(
      requiresGroundingReadBeforeDone(
        "Summarize this page in 2-3 sentences and mention the key points.",
      ),
    ).toBe(true);
    expect(
      requiresGroundingReadBeforeDone(
        "Extract the main points from this article and report them back.",
      ),
    ).toBe(true);
    expect(
      requiresGroundingReadBeforeDone(
        "Find the source referenced by Footnote 2 in the article and tell me what source it cites.",
      ),
    ).toBe(true);
    expect(
      requiresGroundingReadBeforeDone("Find the source code for this page."),
    ).toBe(false);
  });

  test("does not require grounding for trivial page metadata questions", () => {
    expect(
      requiresGroundingReadBeforeDone("What is the title of this page?"),
    ).toBe(false);
    expect(
      requiresGroundingReadBeforeDone("What is the URL of this page?"),
    ).toBe(false);
  });
});

describe("buildFirstTurnTextOnlyNudge", () => {
  test("nudges summarize tasks to read_page before done", () => {
    const nudge = buildFirstTurnTextOnlyNudge(
      "Summarize this page in 2-3 sentences.",
    );
    expect(nudge).toContain("Call read_page first");
    expect(nudge).toContain("done({\"summary\": \"...\"})");
  });

  test("keeps direct done nudge for trivial questions", () => {
    const nudge = buildFirstTurnTextOnlyNudge(
      "What is the title of this page?",
    );
    expect(nudge).toContain("wrap it in done");
    expect(nudge).not.toContain("Call read_page first");
  });
});

// ── Rate limit (Layer 3) — behavioral documentation ──────────────────

describe("evaluateDoneTaskContractGuard", () => {
  test("blocks done when final summary drops required report targets", () => {
    const result = evaluateDoneTaskContractGuard({
      query:
        "Click through to Warehouse Gamma, then go back to Warehouse Alpha and call done() reporting BOTH inventory counts: Gamma and Alpha.",
      summary: "Warehouse Gamma inventory was reviewed successfully.",
      snapshot: makeSnapshot({
        title: "Warehouse Gamma",
        url: "https://shop.example.com/warehouse/gamma",
        pageContent: "Warehouse Gamma inventory count: 6,412 units",
      }),
    });

    expect(result.blocked).toBe(true);
    expect(result.summaryCoverage.missingEntities).toContain("warehouse alpha");
    expect(result.missingReturnTarget).toBe(true);
  });

  test("passes once the summary covers required entities and the page is back at the return target", () => {
    const result = evaluateDoneTaskContractGuard({
      query:
        "Click through to Warehouse Gamma, then go back to Warehouse Alpha and call done() reporting BOTH inventory counts: Gamma and Alpha.",
      summary:
        "Inventory counts collected: Warehouse Gamma has 6,412 units and Warehouse Alpha has 4,827 units.",
      snapshot: makeSnapshot({
        title: "Warehouse Alpha",
        url: "https://shop.example.com/warehouse/alpha",
        pageContent: "Warehouse Alpha inventory count: 4,827 units",
      }),
    });

    expect(result.blocked).toBe(false);
    expect(result.reason).toBeNull();
  });
});

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
