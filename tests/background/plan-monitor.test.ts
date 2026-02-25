import { describe, test, expect } from "vitest";
import type { PlanStep, PlanAlignment, PlanMonitorResult, ReplanResult, PlanDecomposition } from "../../src/background/agent/planner";

// --- Type tests ---

describe("PlanStep.expectedState type", () => {
  test("accepts valid expectedState", () => {
    const step: PlanStep = {
      objective: "Navigate to login page",
      successCriteria: "Login form visible",
      dependencies: [],
      assumptions: [],
      expectedState: {
        description: "Login form with email and password fields",
        urlPattern: "/login",
        expectedPhrases: ["Sign in", "Email"],
      },
    };
    expect(step.expectedState).toBeDefined();
    expect(step.expectedState!.description).toBe("Login form with email and password fields");
    expect(step.expectedState!.urlPattern).toBe("/login");
    expect(step.expectedState!.expectedPhrases).toEqual(["Sign in", "Email"]);
  });

  test("expectedState is optional", () => {
    const step: PlanStep = {
      objective: "Click submit",
      successCriteria: "Form submitted",
      dependencies: [],
      assumptions: [],
    };
    expect(step.expectedState).toBeUndefined();
  });

  test("expectedState with only description", () => {
    const step: PlanStep = {
      objective: "Fill form",
      successCriteria: "Fields filled",
      dependencies: [],
      assumptions: [],
      expectedState: {
        description: "Form fields are populated with values",
      },
    };
    expect(step.expectedState!.urlPattern).toBeUndefined();
    expect(step.expectedState!.expectedPhrases).toBeUndefined();
  });
});

describe("PlanAlignment type", () => {
  test("all valid alignment values", () => {
    const values: PlanAlignment[] = ["aligned", "progressing", "deviated", "blocked"];
    expect(values).toHaveLength(4);
  });
});

describe("PlanMonitorResult type", () => {
  test("aligned result", () => {
    const result: PlanMonitorResult = {
      alignment: "aligned",
      reason: "All phrases matched",
    };
    expect(result.replanFromIndex).toBeUndefined();
    expect(result.blocker).toBeUndefined();
  });

  test("deviated result with replan index", () => {
    const result: PlanMonitorResult = {
      alignment: "deviated",
      reason: "URL doesn't match expected pattern",
      replanFromIndex: 2,
    };
    expect(result.replanFromIndex).toBe(2);
  });

  test("blocked result with blocker", () => {
    const result: PlanMonitorResult = {
      alignment: "blocked",
      reason: "Login required",
      blocker: "Must authenticate first",
    };
    expect(result.blocker).toBe("Must authenticate first");
  });
});

describe("ReplanResult type", () => {
  test("valid replan result", () => {
    const result: ReplanResult = {
      newSteps: [
        {
          objective: "Re-authenticate",
          successCriteria: "Logged in",
          dependencies: [],
          assumptions: ["Session expired"],
          expectedState: {
            description: "Dashboard visible after login",
            urlPattern: "/dashboard",
          },
        },
      ],
      reason: "Session expired, need to re-authenticate",
    };
    expect(result.newSteps).toHaveLength(1);
    expect(result.reason).toContain("Session expired");
  });
});

// --- Heuristic matching tests ---

describe("Heuristic plan monitor logic", () => {
  // Simulate the heuristic logic from monitorStep Phase A

  function heuristicCheck(
    step: PlanStep,
    perception: string,
    pageUrl: string,
  ): PlanMonitorResult | null {
    if (!step.expectedState) return null;
    const expected = step.expectedState;

    // Check for BLOCKERS in perception
    const blockerMatch = perception.match(/BLOCKERS:[\s\S]*?(?=\n[A-Z]+:|$)/i);
    if (blockerMatch) {
      const blockerText = blockerMatch[0];
      if (/PREREQ\b/i.test(blockerText)) {
        const prereqMatch = blockerText.match(/PREREQ\s+"?([^"\n]+)"?/i);
        return {
          alignment: "blocked",
          reason: "Prerequisite blocker detected in perception",
          blocker: prereqMatch?.[1] || "Unknown prerequisite",
        };
      }
    }

    // URL pattern check
    let urlMatches = true;
    if (expected.urlPattern) {
      try {
        urlMatches = new RegExp(expected.urlPattern, "i").test(pageUrl);
      } catch {
        urlMatches = true;
      }
    }

    // Phrase matching
    const phrases = expected.expectedPhrases || [];
    const lowerPerception = perception.toLowerCase();
    let matchedPhrases = 0;
    for (const phrase of phrases) {
      if (lowerPerception.includes(phrase.toLowerCase())) {
        matchedPhrases++;
      }
    }

    // Heuristic decisions
    if (urlMatches && phrases.length > 0 && matchedPhrases === phrases.length) {
      return {
        alignment: "aligned",
        reason: `URL matches and all ${phrases.length} expected phrases found`,
      };
    }
    if (urlMatches && phrases.length > 0 && matchedPhrases > 0) {
      return {
        alignment: "progressing",
        reason: `URL matches, ${matchedPhrases}/${phrases.length} expected phrases found`,
      };
    }

    return null; // Inconclusive → would fall through to LLM
  }

  test("returns null when no expectedState", () => {
    const step: PlanStep = {
      objective: "Click button",
      successCriteria: "Button clicked",
      dependencies: [],
      assumptions: [],
    };
    expect(heuristicCheck(step, "LAYOUT: Some page", "https://example.com")).toBeNull();
  });

  test("detects PREREQ blocker", () => {
    const step: PlanStep = {
      objective: "Submit form",
      successCriteria: "Form submitted",
      dependencies: [],
      assumptions: [],
      expectedState: {
        description: "Confirmation page visible",
        expectedPhrases: ["Thank you"],
      },
    };
    const perception = `LAYOUT: Quiz page
STATE: Active
CONTENT: Quiz question
BLOCKERS:
PREREQ "complete quiz to reveal submit button"
SPATIAL: Form below quiz`;

    const result = heuristicCheck(step, perception, "https://example.com/quiz");
    expect(result).not.toBeNull();
    expect(result!.alignment).toBe("blocked");
    expect(result!.blocker).toContain("complete quiz");
  });

  test("returns aligned when URL matches and all phrases found", () => {
    const step: PlanStep = {
      objective: "Navigate to dashboard",
      successCriteria: "Dashboard loaded",
      dependencies: [],
      assumptions: [],
      expectedState: {
        description: "Dashboard with user info",
        urlPattern: "/dashboard",
        expectedPhrases: ["Welcome", "Settings"],
      },
    };
    const perception = `LAYOUT: Dashboard page
CONTENT: Welcome back! Your Settings are here.
BLOCKERS: None.`;

    const result = heuristicCheck(step, perception, "https://app.com/dashboard");
    expect(result).not.toBeNull();
    expect(result!.alignment).toBe("aligned");
  });

  test("returns progressing when URL matches but only some phrases found", () => {
    const step: PlanStep = {
      objective: "Navigate to dashboard",
      successCriteria: "Dashboard loaded",
      dependencies: [],
      assumptions: [],
      expectedState: {
        description: "Dashboard with user info",
        urlPattern: "/dashboard",
        expectedPhrases: ["Welcome", "Settings", "Notifications"],
      },
    };
    const perception = `LAYOUT: Dashboard page
CONTENT: Welcome back! Loading...
BLOCKERS: None.`;

    const result = heuristicCheck(step, perception, "https://app.com/dashboard");
    expect(result).not.toBeNull();
    expect(result!.alignment).toBe("progressing");
    expect(result!.reason).toContain("1/3");
  });

  test("returns null (inconclusive) when URL doesn't match", () => {
    const step: PlanStep = {
      objective: "Go to checkout",
      successCriteria: "Checkout page",
      dependencies: [],
      assumptions: [],
      expectedState: {
        description: "Checkout form",
        urlPattern: "/checkout",
        expectedPhrases: ["Payment"],
      },
    };
    const result = heuristicCheck(step, "LAYOUT: Cart page", "https://shop.com/cart");
    expect(result).toBeNull(); // Inconclusive — needs LLM
  });

  test("returns aligned when no URL pattern and all phrases match", () => {
    const step: PlanStep = {
      objective: "Fill form",
      successCriteria: "Fields filled",
      dependencies: [],
      assumptions: [],
      expectedState: {
        description: "Form populated",
        expectedPhrases: ["Name", "Email"],
      },
    };
    const perception = `CONTENT: name field, email field, phone`;
    const result = heuristicCheck(step, perception, "https://example.com/form");
    expect(result).not.toBeNull();
    expect(result!.alignment).toBe("aligned");
  });

  test("phrase matching is case-insensitive", () => {
    const step: PlanStep = {
      objective: "Check results",
      successCriteria: "Results visible",
      dependencies: [],
      assumptions: [],
      expectedState: {
        description: "Search results displayed",
        expectedPhrases: ["Search Results"],
      },
    };
    const perception = "CONTENT: search results found for your query";
    const result = heuristicCheck(step, perception, "https://example.com");
    expect(result).not.toBeNull();
    expect(result!.alignment).toBe("aligned");
  });
});

// --- expectedState parsing tests ---

describe("expectedState parsing in decomposition", () => {
  test("PlanStep with expectedState round-trips correctly", () => {
    const raw = {
      objective: "Log in",
      successCriteria: "Authenticated",
      dependencies: [],
      assumptions: ["User is on login page"],
      expectedState: {
        description: "Dashboard visible after login",
        urlPattern: "/dashboard",
        expectedPhrases: ["Welcome", "Logout"],
      },
    };

    // Simulate the parsing logic from decompose()
    const obj = raw as Record<string, unknown>;
    let expectedState: PlanStep["expectedState"];
    if (
      obj.expectedState &&
      typeof obj.expectedState === "object" &&
      !Array.isArray(obj.expectedState)
    ) {
      const es = obj.expectedState as Record<string, unknown>;
      if (typeof es.description === "string" && (es.description as string).trim().length > 0) {
        expectedState = {
          description: (es.description as string).trim(),
          ...(typeof es.urlPattern === "string" && (es.urlPattern as string).trim().length > 0
            ? { urlPattern: (es.urlPattern as string).trim() }
            : {}),
          ...(Array.isArray(es.expectedPhrases)
            ? {
                expectedPhrases: (es.expectedPhrases as unknown[])
                  .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
                  .map((p) => p.trim()),
              }
            : {}),
        };
      }
    }

    expect(expectedState).toBeDefined();
    expect(expectedState!.description).toBe("Dashboard visible after login");
    expect(expectedState!.urlPattern).toBe("/dashboard");
    expect(expectedState!.expectedPhrases).toEqual(["Welcome", "Logout"]);
  });

  test("skips expectedState with empty description", () => {
    const raw = {
      expectedState: { description: "  " },
    };
    const obj = raw as Record<string, unknown>;
    let expectedState: PlanStep["expectedState"];
    if (
      obj.expectedState &&
      typeof obj.expectedState === "object" &&
      !Array.isArray(obj.expectedState)
    ) {
      const es = obj.expectedState as Record<string, unknown>;
      if (typeof es.description === "string" && (es.description as string).trim().length > 0) {
        expectedState = { description: (es.description as string).trim() };
      }
    }
    expect(expectedState).toBeUndefined();
  });

  test("handles expectedState without optional fields", () => {
    const raw = {
      expectedState: { description: "Page loaded" },
    };
    const obj = raw as Record<string, unknown>;
    let expectedState: PlanStep["expectedState"];
    if (
      obj.expectedState &&
      typeof obj.expectedState === "object" &&
      !Array.isArray(obj.expectedState)
    ) {
      const es = obj.expectedState as Record<string, unknown>;
      if (typeof es.description === "string" && (es.description as string).trim().length > 0) {
        expectedState = {
          description: (es.description as string).trim(),
          ...(typeof es.urlPattern === "string" && (es.urlPattern as string).trim().length > 0
            ? { urlPattern: (es.urlPattern as string).trim() }
            : {}),
          ...(Array.isArray(es.expectedPhrases)
            ? {
                expectedPhrases: (es.expectedPhrases as unknown[])
                  .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
                  .map((p) => p.trim()),
              }
            : {}),
        };
      }
    }
    expect(expectedState).toBeDefined();
    expect(expectedState!.description).toBe("Page loaded");
    expect(expectedState!.urlPattern).toBeUndefined();
    expect(expectedState!.expectedPhrases).toBeUndefined();
  });

  test("filters invalid phrases from expectedPhrases", () => {
    const raw = {
      expectedState: {
        description: "Results page",
        expectedPhrases: ["Valid", "", 42, "  Also Valid  "],
      },
    };
    const obj = raw as Record<string, unknown>;
    let expectedState: PlanStep["expectedState"];
    if (
      obj.expectedState &&
      typeof obj.expectedState === "object" &&
      !Array.isArray(obj.expectedState)
    ) {
      const es = obj.expectedState as Record<string, unknown>;
      if (typeof es.description === "string" && (es.description as string).trim().length > 0) {
        expectedState = {
          description: (es.description as string).trim(),
          ...(Array.isArray(es.expectedPhrases)
            ? {
                expectedPhrases: (es.expectedPhrases as unknown[])
                  .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
                  .map((p) => p.trim()),
              }
            : {}),
        };
      }
    }
    expect(expectedState!.expectedPhrases).toEqual(["Valid", "Also Valid"]);
  });
});

// --- Trace event types ---

describe("Trace event types", () => {
  test("plan_monitor event structure", () => {
    const event = {
      type: "plan_monitor" as const,
      timestamp: Date.now(),
      data: {
        stepIndex: 1,
        alignment: "deviated" as const,
        reason: "URL mismatch",
        heuristicHit: false,
      },
    };
    expect(event.data.stepIndex).toBe(1);
    expect(event.data.alignment).toBe("deviated");
  });

  test("plan_replan event structure", () => {
    const event = {
      type: "plan_replan" as const,
      timestamp: Date.now(),
      data: {
        fromIndex: 2,
        newStepCount: 3,
        reason: "Checkout flow changed",
        replanNumber: 1,
      },
    };
    expect(event.data.fromIndex).toBe(2);
    expect(event.data.newStepCount).toBe(3);
  });
});
