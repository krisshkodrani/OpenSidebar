import { describe, expect, test } from "vitest";
import "../setup";
import { getSessionModels, shortModel } from "../../src/trace-viewer/utils";

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
});
