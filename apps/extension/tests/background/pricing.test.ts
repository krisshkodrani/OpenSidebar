import { describe, expect, test } from "vitest";
import "../setup";
import { estimateCostUsd, findModelPricing } from "../../src/background/llm/pricing";

describe("LLM pricing table", () => {
  test("uses refreshed Fireworks Kimi K2.5 Turbo pricing", () => {
    const pricing = findModelPricing(
      "fireworks",
      "accounts/fireworks/routers/kimi-k2p5-turbo",
    );
    expect(pricing).toMatchObject({
      inputUsdPerMillion: 0.99,
      outputUsdPerMillion: 4.94,
      cachedInputUsdPerMillion: 0.16,
    });
  });

  test("includes Groq pricing for GPT-OSS 120B", () => {
    const pricing = findModelPricing("groq", "openai/gpt-oss-120b");
    expect(pricing).toMatchObject({
      inputUsdPerMillion: 0.15,
      outputUsdPerMillion: 0.6,
      cachedInputUsdPerMillion: 0.075,
    });
  });

  test("estimates cached prompt tokens at the cached rate", () => {
    const cost = estimateCostUsd("groq", "openai/gpt-oss-120b", {
      prompt_tokens: 1_000_000,
      completion_tokens: 1_000_000,
      total_tokens: 2_000_000,
      cached_tokens: 500_000,
    });
    expect(cost).toBeCloseTo(0.15 * 0.5 + 0.075 * 0.5 + 0.6, 6);
  });
});
