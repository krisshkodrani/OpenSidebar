import { describe, expect, test } from "vitest";
import "../setup";
import {
  estimateCostBreakdownUsd,
  estimateCostUsd,
  findModelPricing,
} from "../../src/background/llm/pricing";
import { DEFAULT_MODEL_PRICING } from "../../src/background/llm/pricing-data";

describe("LLM pricing table", () => {
  test("uses checked-in local pricing defaults", () => {
    expect(DEFAULT_MODEL_PRICING.length).toBeGreaterThan(0);
    expect(
      DEFAULT_MODEL_PRICING.every(
        (entry) =>
          entry.providerId &&
          entry.model &&
          Number.isFinite(entry.inputUsdPerMillion) &&
          Number.isFinite(entry.outputUsdPerMillion),
      ),
    ).toBe(true);
  });

  test("uses refreshed Fireworks Kimi K2.6 Turbo pricing", () => {
    const pricing = findModelPricing(
      "fireworks",
      "accounts/fireworks/routers/kimi-k2p6-turbo",
    );
    expect(pricing).toMatchObject({
      inputUsdPerMillion: 2.0,
      outputUsdPerMillion: 8.0,
      cachedInputUsdPerMillion: 0.3,
      effectiveDate: "2026-05-29",
      sourceUrl: "https://docs.fireworks.ai/serverless/pricing",
      confidence: "official",
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

  test("includes Moonshot pricing for Kimi K2.6", () => {
    const pricing = findModelPricing("moonshot", "kimi-k2.6");
    expect(pricing).toMatchObject({
      inputUsdPerMillion: 0.95,
      outputUsdPerMillion: 4.0,
      cachedInputUsdPerMillion: 0.16,
    });
  });

  test("includes DeepSeek V4 Flash pricing", () => {
    const pricing = findModelPricing("deepseek", "deepseek-v4-flash");
    expect(pricing).toMatchObject({
      inputUsdPerMillion: 0.14,
      outputUsdPerMillion: 0.28,
      cachedInputUsdPerMillion: 0.0028,
    });
  });

  test("includes Xiaomi MiMo placeholder pricing as best effort", () => {
    const pricing = findModelPricing("xiaomi", "mimo-v2-omni");
    expect(pricing).toMatchObject({
      inputUsdPerMillion: 0,
      outputUsdPerMillion: 0,
      confidence: "best_effort",
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

  test("returns input, cached input, and output cost components", () => {
    const breakdown = estimateCostBreakdownUsd(
      "fireworks",
      "accounts/fireworks/routers/kimi-k2p6-turbo",
      {
        prompt_tokens: 1_000,
        cached_tokens: 400,
        completion_tokens: 100,
        total_tokens: 1_100,
      },
    );

    expect(breakdown).toMatchObject({
      promptTokens: 1_000,
      nonCachedPromptTokens: 600,
      cachedTokens: 400,
      completionTokens: 100,
    });
    expect(breakdown?.inputCostUsd).toBeCloseTo(0.0012, 8);
    expect(breakdown?.cachedInputCostUsd).toBeCloseTo(0.00012, 8);
    expect(breakdown?.outputCostUsd).toBeCloseTo(0.0008, 8);
    expect(breakdown?.totalCostUsd).toBeCloseTo(0.00212, 8);
  });

  test("returns null for unknown model pricing", () => {
    expect(findModelPricing("fireworks", "unknown/model")).toBeNull();
    expect(
      estimateCostUsd("fireworks", "unknown/model", {
        prompt_tokens: 100,
        completion_tokens: 100,
        total_tokens: 200,
      }),
    ).toBeNull();
  });
});
