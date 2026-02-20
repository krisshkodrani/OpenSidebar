import { describe, expect, test } from "bun:test";
import { estimateCostUsd, findModelPricing } from "../../src/background/llm/pricing";

describe("pricing estimator", () => {
  test("returns null when pricing is unknown", () => {
    const cost = estimateCostUsd("cerebras", "unknown-model-xyz", {
      prompt_tokens: 1000,
      completion_tokens: 500,
      total_tokens: 1500,
    });
    expect(cost).toBeNull();
  });

  test("estimates groq cached + uncached prompt cost", () => {
    const cost = estimateCostUsd("groq", "openai/gpt-oss-120b", {
      prompt_tokens: 100_000,
      completion_tokens: 20_000,
      total_tokens: 120_000,
      cached_tokens: 40_000,
    });
    expect(cost).not.toBeNull();
    // prompt (60k * 0.15/M) + cached (40k * 0.075/M) + output (20k * 0.60/M)
    expect(cost!).toBeCloseTo(0.024, 8);
  });

  test("finds known openrouter pricing", () => {
    const pricing = findModelPricing("openrouter", "openai/gpt-oss-120b");
    expect(pricing).not.toBeNull();
    expect(pricing?.inputUsdPerMillion).toBe(0.039);
    expect(pricing?.outputUsdPerMillion).toBe(0.19);
  });
});

