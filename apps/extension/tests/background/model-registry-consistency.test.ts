import { describe, expect, test } from "vitest";
import "../setup";
import { DEFAULT_MODEL_PRICING } from "../../src/background/llm/pricing-data";
import { DEFAULT_LLM_MODEL_CONFIG } from "../../src/config/model-config";
import {
  DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER,
  isExecutorEligible,
} from "../../src/utils/executor-model-policy";
import {
  CEREBRAS_MODELS,
  DEEPSEEK_MODELS,
  FIREWORKS_MODELS,
  GROQ_MODELS,
  MOONSHOT_MODELS,
  XIAOMI_MODELS,
  type ProviderModelOption,
} from "../../src/sidepanel/hooks/useOpenRouterModels";

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

function pricingRow(providerId: string, model: string) {
  return DEFAULT_MODEL_PRICING.find(
    (p) => p.providerId === providerId && p.model === model,
  );
}

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

  test("curated sidepanel catalogs agree with pricing-data on provider and rates", () => {
    const catalogs: ProviderModelOption[] = [
      ...FIREWORKS_MODELS,
      ...MOONSHOT_MODELS,
      ...XIAOMI_MODELS,
      ...DEEPSEEK_MODELS,
      ...GROQ_MODELS,
      ...CEREBRAS_MODELS,
    ];
    for (const option of catalogs) {
      const row = pricingRow(option.provider!, option.id);
      expect(row, `${option.provider}/${option.id} missing from pricing-data`)
        .toBeDefined();
      expect(
        option.promptPrice * 1_000_000,
        `${option.id} prompt price drifted from pricing-data`,
      ).toBeCloseTo(row!.inputUsdPerMillion, 6);
      expect(
        option.completionPrice * 1_000_000,
        `${option.id} completion price drifted from pricing-data`,
      ).toBeCloseTo(row!.outputUsdPerMillion, 6);
    }
  });

  /**
   * Fireworks addresses models as `accounts/fireworks/models/...`; a
   * catalog-style id 404s on that endpoint (proven live for
   * `openai/gpt-oss-120b` — the judge-seat incident).
   *
   * `qwen/qwen3-vl-30b-a3b-instruct` predates that finding and is the one
   * catalog-form id still in the Fireworks catalog. It is listed here rather
   * than silently rewritten because nothing proves its correct Fireworks id:
   * no recorded run has ever exercised it, so it cannot be corrected without
   * a live check against the API. Verify it with a Fireworks key and either
   * fix the id or drop the entry — then delete this exception.
   */
  const UNVERIFIED_FIREWORKS_CATALOG_IDS = new Set([
    "qwen/qwen3-vl-30b-a3b-instruct",
  ]);

  test("Fireworks-served ids use the accounts/... API form", () => {
    for (const option of FIREWORKS_MODELS) {
      if (UNVERIFIED_FIREWORKS_CATALOG_IDS.has(option.id)) continue;
      expect(
        option.id.startsWith("accounts/"),
        `${option.id} is a catalog-style id; Fireworks needs accounts/...`,
      ).toBe(true);
    }
    const fireworksSeatDefaults = [
      DEFAULT_LLM_MODEL_CONFIG.planner,
      DEFAULT_LLM_MODEL_CONFIG.writer,
      DEFAULT_LLM_MODEL_CONFIG.judge,
      DEFAULT_LLM_MODEL_CONFIG.fireworks.executor,
      DEFAULT_LLM_MODEL_CONFIG.fireworks.planner,
    ];
    for (const model of fireworksSeatDefaults) {
      expect(
        model.startsWith("accounts/"),
        `${model} is a catalog-style id; Fireworks needs accounts/...`,
      ).toBe(true);
    }
  });
});
