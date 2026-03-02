import { describe, it, expect } from "vitest";
import {
  extractStepIndicator,
  detectInstructionContradiction,
  GROUNDING_OBSERVATION_TOOLS,
  type ContradictionResult,
} from "../../src/background/agent/loop-helpers";
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
