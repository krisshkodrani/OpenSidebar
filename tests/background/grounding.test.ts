import { describe, it, expect } from "vitest";
import {
  detectPendingAsyncChange,
  detectStructuralStepAdvance,
  extractStepIndicator,
  detectInstructionContradiction,
  GROUNDING_OBSERVATION_TOOLS,
  buildFailureBrief,
  isPendingAsyncChangeSatisfied,
  validateElementIds,
  type ContradictionResult,
  type SubgoalAttempt,
} from "../../src/background/agent/loop-helpers";
import { ToolName } from "../../src/types";
import type { DomSnapshot } from "../../src/types";

function makeSnapshot(overrides: Partial<DomSnapshot> = {}): DomSnapshot {
  return {
    title: "Test Page",
    url: "https://example.com",
    elements: [],
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    ...overrides,
  };
}

describe("GROUNDING_OBSERVATION_TOOLS", () => {
  it("contains the expected observation tools", () => {
    expect(GROUNDING_OBSERVATION_TOOLS.has("read_page")).toBe(true);
    expect(GROUNDING_OBSERVATION_TOOLS.has("find_element")).toBe(true);
    expect(GROUNDING_OBSERVATION_TOOLS.has("read_element")).toBe(true);
    expect(GROUNDING_OBSERVATION_TOOLS.has("xray_page")).toBe(true);
    expect(GROUNDING_OBSERVATION_TOOLS.has("scroll_page")).toBe(true);
  });

  it("does not contain action tools", () => {
    expect(GROUNDING_OBSERVATION_TOOLS.has("click_element")).toBe(false);
    expect(GROUNDING_OBSERVATION_TOOLS.has("type_text")).toBe(false);
    expect(GROUNDING_OBSERVATION_TOOLS.has("navigate")).toBe(false);
  });
});

describe("extractStepIndicator", () => {
  it("extracts step from URL path /stepN", () => {
    expect(extractStepIndicator("/step3?version=1")).toEqual({ step: 3 });
    expect(extractStepIndicator("https://example.com/step12")).toEqual({ step: 12 });
  });

  it("extracts step from prose 'step N'", () => {
    expect(extractStepIndicator("You are on step 5")).toEqual({ step: 5 });
    expect(extractStepIndicator("Complete Step 2 of the challenge")).toEqual({ step: 2 });
  });

  it("extracts step from 'on step N' pattern", () => {
    expect(extractStepIndicator("Currently on step 7")).toEqual({ step: 7 });
  });

  it("returns null when no step found", () => {
    expect(extractStepIndicator("Navigate to the next article")).toBeNull();
    expect(extractStepIndicator("Click the submit button")).toBeNull();
    expect(extractStepIndicator("")).toBeNull();
  });

  it("returns the first match", () => {
    // URL match should come first since /step pattern is checked before prose
    expect(extractStepIndicator("/step3 you are on step 5")).toEqual({ step: 3 });
  });
});

describe("detectInstructionContradiction", () => {
  describe("step mismatch", () => {
    it("detects step mismatch between instruction and page", () => {
      const result = detectInstructionContradiction(
        "Complete step 2 of the challenge",
        makeSnapshot({
          url: "https://example.com/step5",
          title: "Challenge - Step 5",
          pageContent: "You are on step 5",
        }),
      );
      expect(result).not.toBeNull();
      expect(result!.mismatch).toBe(true);
      expect(result!.details).toContain("step 2");
      expect(result!.details).toContain("step 5");
    });

    it("returns null when steps match", () => {
      const result = detectInstructionContradiction(
        "Complete step 3 of the challenge",
        makeSnapshot({
          url: "https://example.com/step3",
          title: "Challenge - Step 3",
        }),
      );
      expect(result).toBeNull();
    });

    it("returns null when instruction has no step", () => {
      const result = detectInstructionContradiction(
        "Click the submit button",
        makeSnapshot({
          url: "https://example.com/step5",
          title: "Challenge - Step 5",
        }),
      );
      expect(result).toBeNull();
    });

    it("returns null when page has no step", () => {
      const result = detectInstructionContradiction(
        "Complete step 2",
        makeSnapshot({
          url: "https://example.com/quiz",
          title: "Quiz Page",
        }),
      );
      expect(result).toBeNull();
    });
  });

  describe("page-type mismatch", () => {
    it("detects checkout instruction on cart page", () => {
      const result = detectInstructionContradiction(
        "Fill out the checkout form with your shipping address",
        makeSnapshot({
          url: "https://shop.com/cart",
          title: "Your Shopping Cart",
        }),
      );
      expect(result).not.toBeNull();
      expect(result!.mismatch).toBe(true);
      expect(result!.details).toContain("checkout");
    });

    it("returns null when page is actually checkout", () => {
      const result = detectInstructionContradiction(
        "Fill out the checkout form",
        makeSnapshot({
          url: "https://shop.com/checkout",
          title: "Checkout - Payment",
        }),
      );
      expect(result).toBeNull();
    });

    it("returns null for unrelated instruction and page", () => {
      const result = detectInstructionContradiction(
        "Click the navigation link at the bottom of the page",
        makeSnapshot({
          url: "https://blog.com/article/getting-started",
          title: "Getting Started Guide",
        }),
      );
      expect(result).toBeNull();
    });
  });

  describe("no false positives", () => {
    it("returns null for matching instruction and page", () => {
      const result = detectInstructionContradiction(
        "Enter the 6-character code to proceed",
        makeSnapshot({
          url: "https://challenge.com/step3",
          title: "Challenge Step 3",
        }),
      );
      expect(result).toBeNull();
    });

    it("returns null for generic instruction", () => {
      const result = detectInstructionContradiction(
        "Navigate to the next article",
        makeSnapshot({
          url: "https://blog.com/article/1",
          title: "Blog Post",
        }),
      );
      expect(result).toBeNull();
    });
  });
});

// ─── buildFailureBrief tests ──────────────────────────────────────────

function makeAttempt(overrides: Partial<SubgoalAttempt> = {}): SubgoalAttempt {
  return {
    turn: 1,
    tool: "click_element",
    args: '{"id":5}',
    outcome: "Clicked element [5]",
    wasFailure: false,
    snapshotFp: "https://example.com|10|12345",
    ...overrides,
  };
}

describe("buildFailureBrief", () => {
  it("returns empty string for fewer than 3 attempts", () => {
    expect(buildFailureBrief([])).toBe("");
    expect(buildFailureBrief([makeAttempt()])).toBe("");
    expect(buildFailureBrief([makeAttempt(), makeAttempt()])).toBe("");
  });

  it("formats attempts with turn numbers and outcomes", () => {
    const attempts = [
      makeAttempt({ turn: 1, tool: "click_element", args: '{"id":5}', outcome: "Clicked [5]" }),
      makeAttempt({ turn: 2, tool: "scroll_page", args: '{"dir":"down"}', outcome: "Scrolled down" }),
      makeAttempt({ turn: 3, tool: "type_text", args: '{"id":3,"text":"hi"}', outcome: "Typed" }),
    ];
    const brief = buildFailureBrief(attempts);
    expect(brief).toContain("T1: click_element");
    expect(brief).toContain("T2: scroll_page");
    expect(brief).toContain("T3: type_text");
    expect(brief).toContain("Attempts (3):");
  });

  it("marks failures with FAIL: prefix", () => {
    const attempts = [
      makeAttempt({ turn: 1, wasFailure: true, outcome: "Error: not found" }),
      makeAttempt({ turn: 2, wasFailure: false, outcome: "OK" }),
      makeAttempt({ turn: 3, wasFailure: true, outcome: "Click intercepted" }),
    ];
    const brief = buildFailureBrief(attempts);
    expect(brief).toContain("FAIL: Error: not found");
    expect(brief).not.toContain("FAIL: OK");
    expect(brief).toContain("FAIL: Click intercepted");
  });

  describe("synthesis heuristics", () => {
    it("detects covered-by pattern", () => {
      const attempts = [
        makeAttempt({ turn: 1, outcome: "Click intercepted: covered by [12]", wasFailure: true }),
        makeAttempt({ turn: 2 }),
        makeAttempt({ turn: 3 }),
      ];
      const brief = buildFailureBrief(attempts);
      expect(brief).toContain("Element is covered by another element");
    });

    it("detects dismiss_overlays with no overlays", () => {
      const attempts = [
        makeAttempt({ turn: 1, tool: "dismiss_overlays", outcome: "No overlays found", wasFailure: false }),
        makeAttempt({ turn: 2 }),
        makeAttempt({ turn: 3 }),
      ];
      const brief = buildFailureBrief(attempts);
      expect(brief).toContain("Covering element is NOT an overlay");
    });

    it("detects hide_element failure", () => {
      const attempts = [
        makeAttempt({ turn: 1, tool: "hide_element", outcome: "Error: cannot hide", wasFailure: true }),
        makeAttempt({ turn: 2 }),
        makeAttempt({ turn: 3 }),
      ];
      const brief = buildFailureBrief(attempts);
      expect(brief).toContain("Covering element cannot be hidden");
    });

    it("detects execute_js undefined result", () => {
      const attempts = [
        makeAttempt({ turn: 1, tool: "execute_js", outcome: "Result: undefined", wasFailure: false }),
        makeAttempt({ turn: 2 }),
        makeAttempt({ turn: 3 }),
      ];
      const brief = buildFailureBrief(attempts);
      expect(brief).toContain("JS approach returned undefined");
    });
  });

  it("suggests untried tools", () => {
    const attempts = [
      makeAttempt({ turn: 1, tool: "click_element" }),
      makeAttempt({ turn: 2, tool: "type_text" }),
      makeAttempt({ turn: 3, tool: "scroll_page" }),
    ];
    const brief = buildFailureBrief(attempts);
    expect(brief).toContain("Untried tools:");
    expect(brief).toContain("click_coordinates");
    expect(brief).toContain("press_key");
    expect(brief).toContain("navigate");
    expect(brief).toContain("execute_js");
    expect(brief).toContain("find_element");
    // scroll_page was tried, should not appear
    expect(brief).not.toMatch(/Untried tools:.*scroll_page/);
  });

  it("omits untried tools section when all alternatives were tried", () => {
    const tools = ["click_coordinates", "scroll_page", "press_key", "navigate", "execute_js", "find_element"];
    const attempts = tools.map((tool, i) =>
      makeAttempt({ turn: i + 1, tool }),
    );
    const brief = buildFailureBrief(attempts);
    expect(brief).not.toContain("Untried tools:");
  });

  it("truncates output to 600 chars", () => {
    // Create many attempts with long args/outcomes
    const attempts = Array.from({ length: 15 }, (_, i) =>
      makeAttempt({
        turn: i + 1,
        tool: "click_element",
        args: `{"id":${i},"longparam":"${"x".repeat(80)}"}`,
        outcome: `Result with long description ${"y".repeat(80)}`,
      }),
    );
    const brief = buildFailureBrief(attempts);
    expect(brief.length).toBeLessThanOrEqual(600);
  });
});

describe("validateElementIds", () => {
  it("explains that discovery ids are not guaranteed actionable tags", () => {
    const snapshot = makeSnapshot({
      elements: [
        {
          tag: 5,
          tagName: "button",
          role: "button",
          text: "Open Cart",
          attributes: {},
          rect: { x: 0, y: 0, width: 10, height: 10, pageY: 0 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    });

    const error = validateElementIds(
      ToolName.CLICK_ELEMENT,
      { id: 28 },
      snapshot,
    );

    expect(error).toContain("locator references");
    expect(error).toContain("current Visible Elements list");
  });
});

describe("detectStructuralStepAdvance", () => {
  it("advances when the next step becomes directly grounded after a material change", () => {
    const signal = detectStructuralStepAdvance({
      currentStepDescription:
        "Click the Add to cart button next to the Air Zoom Pegasus 41 running shoe",
      currentStepSuccessCriteria:
        "Cart section appears automatically with the item visible",
      nextStepDescription:
        "Type SAVE10 into the promo code input field, click Apply button, then click the Express radio button for shipping",
      currentSnapshot: makeSnapshot({
        pageContent:
          "Your Cart Air Zoom Pegasus 41 Promo Code SAVE10 Apply Shipping Express Checkout",
        elements: [
          {
            tag: 19,
            tagName: "input",
            role: "text",
            text: "SAVE10",
            attributes: { placeholder: "SAVE10" },
            rect: { x: 0, y: 0, width: 10, height: 10, pageY: 0 },
            isVisible: true,
            isDisabled: false,
          },
          {
            tag: 22,
            tagName: "button",
            role: "button",
            text: "Apply",
            attributes: { id: "apply-coupon" },
            rect: { x: 0, y: 0, width: 10, height: 10, pageY: 0 },
            isVisible: true,
            isDisabled: false,
          },
          {
            tag: 18,
            tagName: "input",
            role: "radio",
            text: "Express",
            attributes: { value: "express" },
            rect: { x: 0, y: 0, width: 10, height: 10, pageY: 0 },
            isVisible: true,
            isDisabled: false,
          },
        ],
      }),
      actionEffect: {
        deltaPercent: 0.35,
        urlChanged: false,
        currentUrl: "https://example.com/shop",
        elementsAdded: 5,
        elementsRemoved: 2,
        prevCount: 10,
        currentCount: 13,
      },
      toolName: ToolName.CLICK_ELEMENT,
    });

    expect(signal).not.toBeNull();
    expect(signal!.matchedTokens).toEqual(
      expect.arrayContaining(["save10", "apply", "express"]),
    );
  });

  it("does not advance when only the next-step affordances are visible without current-step success evidence", () => {
    const signal = detectStructuralStepAdvance({
      currentStepDescription:
        "Click the Add to cart button next to the Air Zoom Pegasus 41 running shoe",
      currentStepSuccessCriteria:
        "Cart section appears automatically with the item visible",
      nextStepDescription:
        "Type SAVE10 into the promo code input field, click Apply button, then click the Express radio button for shipping",
      currentSnapshot: makeSnapshot({
        pageContent: "Promo Code SAVE10 Apply Shipping Express Checkout",
        elements: [
          {
            tag: 19,
            tagName: "input",
            role: "text",
            text: "SAVE10",
            attributes: { placeholder: "SAVE10" },
            rect: { x: 0, y: 0, width: 10, height: 10, pageY: 0 },
            isVisible: true,
            isDisabled: false,
          },
          {
            tag: 22,
            tagName: "button",
            role: "button",
            text: "Apply",
            attributes: { id: "apply-coupon" },
            rect: { x: 0, y: 0, width: 10, height: 10, pageY: 0 },
            isVisible: true,
            isDisabled: false,
          },
        ],
      }),
      actionEffect: {
        deltaPercent: 0.35,
        urlChanged: false,
        currentUrl: "https://example.com/shop",
        elementsAdded: 5,
        elementsRemoved: 2,
        prevCount: 10,
        currentCount: 13,
      },
      toolName: ToolName.CLICK_ELEMENT,
    });

    expect(signal).toBeNull();
  });

  it("does not advance on minor or irrelevant changes", () => {
    const signal = detectStructuralStepAdvance({
      currentStepDescription: "Click the continue button",
      nextStepDescription: "Type the verification code and submit",
      currentSnapshot: makeSnapshot({
        pageContent: "Continue button still visible",
      }),
      actionEffect: {
        deltaPercent: 0,
        urlChanged: false,
        currentUrl: "https://example.com",
        elementsAdded: 0,
        elementsRemoved: 0,
        prevCount: 10,
        currentCount: 10,
      },
      toolName: ToolName.CLICK_ELEMENT,
    });

    expect(signal).toBeNull();
  });
});

describe("detectPendingAsyncChange", () => {
  it("detects unresolved delayed content after a triggering click", () => {
    const signal = detectPendingAsyncChange({
      currentStepDescription:
        "Click the Load Content button and wait for the loaded text to appear.",
      currentStepSuccessCriteria:
        "The page shows Loaded: The answer is 42.",
      currentSnapshot: makeSnapshot({
        pageContent: "Delayed Content Load Content Loading...",
        elements: [
          {
            tag: 4,
            tagName: "button",
            role: "button",
            text: "Loading...",
            attributes: { id: "load-content" },
            rect: { x: 0, y: 0, width: 10, height: 10, pageY: 0 },
            isVisible: true,
            isDisabled: true,
          },
        ],
      }),
      actionEffect: {
        deltaPercent: 0.2,
        urlChanged: false,
        currentUrl: "https://example.com/error-scenarios",
        elementsAdded: 0,
        elementsRemoved: 0,
        prevCount: 8,
        currentCount: 8,
      },
      toolName: ToolName.CLICK_ELEMENT,
    });

    expect(signal).not.toBeNull();
    expect(signal!.reason).toContain("still pending");
    expect(signal!.expectedTokens).toContain("answer");
    expect(signal!.expectedTokens.some((token) => token.startsWith("42"))).toBe(true);
  });

  it("treats the async expectation as satisfied once the expected content is visible", () => {
    const snapshot = makeSnapshot({
      pageContent: "Delayed Content Loaded: The answer is 42.",
      elements: [
        {
          tag: 8,
          tagName: "p",
          role: "text",
          text: "Loaded: The answer is 42.",
          attributes: { id: "delayed-text" },
          rect: { x: 0, y: 0, width: 10, height: 10, pageY: 0 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    });

    expect(
      isPendingAsyncChangeSatisfied({
        snapshot,
        expectedTokens: ["answer", "42"],
      }),
    ).toBe(true);
  });

  it("ignores structural loading keywords present before the action", () => {
    // Simulate LinkedIn-like page where "loading" is always in the DOM
    const preActionSnapshot = makeSnapshot({
      pageContent: "Feed loading more posts",
      elements: [
        {
          tag: 1,
          tagName: "div",
          role: "feed",
          text: "loading more posts",
          attributes: { "aria-label": "loading" },
          rect: { x: 0, y: 0, width: 10, height: 10, pageY: 0 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    });

    const postActionSnapshot = makeSnapshot({
      pageContent: "Feed loading more posts Start a post",
      elements: [
        {
          tag: 1,
          tagName: "div",
          role: "feed",
          text: "loading more posts",
          attributes: { "aria-label": "loading" },
          rect: { x: 0, y: 0, width: 10, height: 10, pageY: 0 },
          isVisible: true,
          isDisabled: false,
        },
        {
          tag: 2,
          tagName: "button",
          role: "button",
          text: "Start a post",
          attributes: {},
          rect: { x: 0, y: 100, width: 10, height: 10, pageY: 100 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    });

    // With preActionSnapshot, structural "loading" should be ignored
    const signal = detectPendingAsyncChange({
      currentStepDescription: "Open the post composer",
      currentStepSuccessCriteria: "Post composer is visible",
      currentSnapshot: postActionSnapshot,
      preActionSnapshot,
      actionEffect: {
        deltaPercent: 0.15,
        urlChanged: false,
        currentUrl: "https://www.linkedin.com/feed/",
        elementsAdded: 1,
        elementsRemoved: 0,
        prevCount: 1,
        currentCount: 2,
      },
      toolName: ToolName.CLICK_ELEMENT,
    });

    // No signal: "loading" was structural, not triggered by the action
    expect(signal).toBeNull();
  });

  it("detects truly new loading indicators that appear after the action", () => {
    const preActionSnapshot = makeSnapshot({
      pageContent: "Product page",
      elements: [],
    });

    const postActionSnapshot = makeSnapshot({
      pageContent: "Product page processing your order",
      elements: [
        {
          tag: 1,
          tagName: "div",
          role: "status",
          text: "processing your order",
          attributes: {},
          rect: { x: 0, y: 0, width: 10, height: 10, pageY: 0 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    });

    const signal = detectPendingAsyncChange({
      currentStepDescription: "Click Buy Now and wait for order confirmation",
      currentStepSuccessCriteria: "Order confirmation number is visible",
      currentSnapshot: postActionSnapshot,
      preActionSnapshot,
      actionEffect: {
        deltaPercent: 0.3,
        urlChanged: false,
        currentUrl: "https://shop.example.com/product",
        elementsAdded: 1,
        elementsRemoved: 0,
        prevCount: 5,
        currentCount: 6,
      },
      toolName: ToolName.CLICK_ELEMENT,
    });

    // "processing" is a NEW loading indicator → signal should fire
    expect(signal).not.toBeNull();
    expect(signal!.loadingIndicator).toBe("processing");
    expect(signal!.baselineLoadingKeywords).toEqual([]);
  });

  it("isPendingAsyncChangeSatisfied ignores baseline loading keywords", () => {
    // Page still has structural "loading" but expected content is visible
    const snapshot = makeSnapshot({
      pageContent: "Feed loading more posts. Post composer visible.",
      elements: [
        {
          tag: 1,
          tagName: "div",
          role: "dialog",
          text: "Post composer visible",
          attributes: {},
          rect: { x: 0, y: 0, width: 10, height: 10, pageY: 0 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    });

    // Without baseline: would fail because "loading" is present
    expect(
      isPendingAsyncChangeSatisfied({
        snapshot,
        expectedTokens: ["composer", "visible"],
      }),
    ).toBe(false);

    // With baseline: "loading" is structural, should be ignored
    expect(
      isPendingAsyncChangeSatisfied({
        snapshot,
        expectedTokens: ["composer", "visible"],
        baselineLoadingKeywords: ["loading"],
      }),
    ).toBe(true);
  });
});
