import { describe, expect, test } from "vitest";
import "../setup";
import { DEFAULT_MODEL_PRICING } from "../../src/background/llm/pricing-data";
import { DEFAULT_LLM_MODEL_CONFIG } from "../../src/config/model-config";
import {
  DEFAULT_EXECUTOR_MODEL,
  isExecutorEligible,
} from "../../src/utils/executor-model-policy";

/**
 * Cross-checks the hand-maintained model sources: seat defaults
 * (config/model-config.ts), executor eligibility
 * (utils/executor-model-policy.ts), and pricing (llm/pricing-data.ts). Each has
 * a different concern, so they stay separate files, but a model id added to one
 * and forgotten in another fails here instead of silently mispricing a run or
 * seating an ineligible model.
 */

const PRICED_MODEL_IDS = new Set(DEFAULT_MODEL_PRICING.map((p) => p.model));

describe("model registry consistency", () => {
  test("every seat default has a pricing row", () => {
    const unpriced = Object.entries(DEFAULT_LLM_MODEL_CONFIG).filter(
      ([, model]) => !PRICED_MODEL_IDS.has(model),
    );
    expect(unpriced).toEqual([]);
  });

  test("the default executor has a pricing row and is executor-eligible", () => {
    expect(PRICED_MODEL_IDS.has(DEFAULT_EXECUTOR_MODEL)).toBe(true);
    expect(isExecutorEligible(DEFAULT_EXECUTOR_MODEL)).toBe(true);
  });

  test("every seat default uses the OpenRouter catalog id form", () => {
    for (const [seat, model] of Object.entries(DEFAULT_LLM_MODEL_CONFIG)) {
      expect(
        model.startsWith("accounts/"),
        `${seat} (${model}) is not an OpenRouter catalog id`,
      ).toBe(false);
    }
  });

  test("every pricing row belongs to OpenRouter", () => {
    expect(
      DEFAULT_MODEL_PRICING.filter((p) => p.providerId !== "openrouter"),
    ).toEqual([]);
  });
});
