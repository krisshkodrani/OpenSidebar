import { describe, expect, test } from "vitest";
import { estimateCostUsd, findModelPricing } from "../../src/background/llm/pricing";

describe("pricing estimator", () => {
  test("returns null when pricing is unknown", () => {
    const cost = estimateCostUsd("openrouter", "unknown-model-xyz", {
      prompt_tokens: 1000,
      completion_tokens: 500,
      total_tokens: 1500,
    });
    expect(cost).toBeNull();
  });

  test("estimates openrouter prompt + output cost", () => {
    const cost = estimateCostUsd("openrouter", "openai/gpt-oss-120b", {
      prompt_tokens: 100_000,
      completion_tokens: 20_000,
      total_tokens: 120_000,
    });
    expect(cost).not.toBeNull();
    // prompt (100k * 0.039/M) + output (20k * 0.19/M)
    expect(cost!).toBeCloseTo(0.0077, 4);
  });

  test("finds known openrouter pricing", () => {
    const pricing = findModelPricing("openrouter", "openai/gpt-oss-120b");
    expect(pricing).not.toBeNull();
    expect(pricing?.inputUsdPerMillion).toBe(0.039);
    expect(pricing?.outputUsdPerMillion).toBe(0.19);
  });
});
