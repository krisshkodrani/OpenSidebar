import { describe, expect, test } from "vitest";
import "../setup";
import {
  compactTraceTaskLabel,
  extractQueryTitle,
  formatCount,
  formatDuration,
  formatPercent,
  getSessionModels,
  shortModel,
} from "../../src/trace-viewer/utils";

describe("trace-viewer utils", () => {
  test("getSessionModels falls back to metrics.modelBreakdown when models are missing", () => {
    const models = getSessionModels({
      metrics: {
        modelBreakdown: {
          "openai/gpt-5.4-mini:nitro": { calls: 3 },
          "x-ai/grok-4.1-fast": { calls: 1 },
        },
      } as any,
    } as any);

    expect(models).toEqual([
      "openai/gpt-5.4-mini:nitro",
      "x-ai/grok-4.1-fast",
    ]);
  });

  test("getSessionModels merges and deduplicates stored and breakdown models", () => {
    const models = getSessionModels({
      models: ["openai/gpt-5.4-mini:nitro", "manual"],
      metrics: {
        modelBreakdown: {
          "openai/gpt-5.4-mini:nitro": { calls: 3 },
          "x-ai/grok-4.1-fast": { calls: 1 },
        },
      } as any,
    } as any);

    expect(models).toEqual([
      "openai/gpt-5.4-mini:nitro",
      "manual",
      "x-ai/grok-4.1-fast",
    ]);
  });

  test("shortModel strips provider prefix for compact display", () => {
    expect(shortModel("openai/gpt-5.4-mini:nitro")).toBe("gpt-5.4-mini:nitro");
  });

  test("formats observability numbers consistently", () => {
    expect(formatCount(1747)).toBe("1,747");
    expect(formatPercent(0.1408)).toBe("14%");
    expect(formatDuration(1234.4)).toBe("1.2s");
    expect(formatDuration(-100)).toBe("0ms");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("---");
  });

  test("extractQueryTitle compacts enriched planner context", () => {
    const enrichedQuery = [
      "Objective: Complete the workflow for the original request:",
      "RECENT WORKSPACE CONVERSATION:",
      "- Assistant: long previous answer",
      "PROFILE DIGEST CONTEXT:",
      "- Fact: Email = jordan.rivera@example.com",
      "CURRENT REQUEST:",
      "Fill the profile",
      "Planner assumptions:",
      "- No explicit assumptions from planner.",
    ].join("\n");

    expect(compactTraceTaskLabel(enrichedQuery)).toBe("Fill the profile");
    expect(extractQueryTitle(enrichedQuery)).toEqual({
      title: "Fill the profile",
      hasMore: false,
    });
  });
});
