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

  test("prices only OpenRouter models", () => {
    expect(
      DEFAULT_MODEL_PRICING.every((entry) => entry.providerId === "openrouter"),
    ).toBe(true);
    expect(findModelPricing("openrouter", "z-ai/glm-5.2")).toMatchObject({
      sourceUrl: "https://openrouter.ai/z-ai/glm-5.2",
      confidence: "official",
    });
  });

  test("includes the default executor and judge seats", () => {
    expect(findModelPricing("openrouter", "openai/gpt-6-luna")).toMatchObject({
      inputUsdPerMillion: 0.1,
      outputUsdPerMillion: 0.5,
      cachedInputUsdPerMillion: 0.01,
    });
    expect(findModelPricing("openrouter", "typesafe/jev-1.13")).toMatchObject({
      inputUsdPerMillion: 0.042,
      outputUsdPerMillion: 0,
    });
  });

  test("prices cached input below the full input rate for the seat defaults", () => {
    // Regression guard: an omitted cachedInputUsdPerMillion silently falls back
    // to the full input rate (see estimateCostUsd), and a wrong one skews spend
    // reporting.
    for (const model of ["openai/gpt-6-luna", "minimax/minimax-m3"]) {
      const pricing = findModelPricing("openrouter", model);
      expect(pricing?.cachedInputUsdPerMillion).toBeLessThan(
        pricing!.inputUsdPerMillion,
      );
    }
  });

  test("ignores the :nitro routing suffix", () => {
    expect(findModelPricing("openrouter", "openai/gpt-6-luna:nitro")).toEqual(
      findModelPricing("openrouter", "openai/gpt-6-luna"),
    );
  });

  test("estimates cached prompt tokens at the cached rate", () => {
    const cost = estimateCostUsd("openrouter", "openai/gpt-6-luna", {
      prompt_tokens: 1_000_000,
      completion_tokens: 1_000_000,
      total_tokens: 2_000_000,
      cached_tokens: 500_000,
    });
    expect(cost).toBeCloseTo(0.1 * 0.5 + 0.01 * 0.5 + 0.5, 6);
  });

  test("returns input, cached input, and output cost components", () => {
    const breakdown = estimateCostBreakdownUsd(
      "openrouter",
      "openai/gpt-6-luna",
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
    expect(breakdown?.inputCostUsd).toBeCloseTo(0.00006, 8);
    expect(breakdown?.cachedInputCostUsd).toBeCloseTo(0.000004, 8);
    expect(breakdown?.outputCostUsd).toBeCloseTo(0.00005, 8);
    expect(breakdown?.totalCostUsd).toBeCloseTo(0.000114, 8);
  });

  test("returns null for unknown model pricing", () => {
    expect(findModelPricing("openrouter", "unknown/model")).toBeNull();
    expect(
      estimateCostUsd("openrouter", "unknown/model", {
        prompt_tokens: 100,
        completion_tokens: 100,
        total_tokens: 200,
      }),
    ).toBeNull();
  });
});
