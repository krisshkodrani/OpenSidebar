import { describe, expect, test } from "vitest";
import "../setup";
import { DEFAULT_MODEL_PRICING } from "../../src/background/llm/pricing-data";
import { DEFAULT_LLM_MODEL_CONFIG } from "../../src/config/model-config";
import {
  DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER,
  isExecutorEligible,
} from "../../src/utils/executor-model-policy";

/**
 * Cross-checks the three hand-maintained model sources — seat defaults
 * (config/model-config.ts), executor eligibility (utils/executor-model-policy.ts),
 * and pricing (llm/pricing-data.ts) — plus the curated sidepanel catalogs.
 * Each has a different concern, so they stay separate files, but a model id
 * added to one and forgotten in another fails here instead of silently
 * mispricing a run or seating an ineligible model (the judge-seat dead-config
 * and id-form incidents of 2026-07-10 were both this bug class).
 */

const PRICED_MODEL_IDS = new Set(DEFAULT_MODEL_PRICING.map((p) => p.model));

function seatDefaults(): Array<{ seat: string; model: string }> {
  const out: Array<{ seat: string; model: string }> = [];
  for (const [key, value] of Object.entries(DEFAULT_LLM_MODEL_CONFIG)) {
    if (typeof value === "string") {
      out.push({ seat: key, model: value });
    } else {
      for (const [groupKey, groupValue] of Object.entries(value)) {
        out.push({ seat: `${key}.${groupKey}`, model: groupValue });
      }
    }
  }
  return out;
}

describe("model registry consistency", () => {
  test("every seat default has a pricing row", () => {
    const unpriced = seatDefaults().filter(
      ({ model }) => !PRICED_MODEL_IDS.has(model),
    );
    expect(unpriced).toEqual([]);
  });

  test("every per-provider default executor has a pricing row and is executor-eligible", () => {
    for (const [mode, model] of Object.entries(
      DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER,
    )) {
      expect(PRICED_MODEL_IDS.has(model), `${mode} default ${model}`).toBe(
        true,
      );
      expect(
        isExecutorEligible(model, mode as never),
        `${mode} default ${model} must pass its own eligibility policy`,
      ).toBe(true);
    }
  });

  test("all current seat defaults use OpenRouter catalog ids", () => {
    for (const { model } of seatDefaults()) {
      expect(model).toContain("/");
      expect(model.startsWith("accounts/")).toBe(false);
    }
  });
});
