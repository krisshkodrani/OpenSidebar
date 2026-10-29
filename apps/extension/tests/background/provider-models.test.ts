import { describe, expect, test } from "vitest";
import "../setup";
import {
  formatPrice,
  formatPricingBadge,
  getProviderModelCatalogNote,
  getProviderModelOptions,
} from "../../src/sidepanel/hooks/useOpenRouterModels";
import {
  DEFAULT_EXECUTOR_MODEL,
  EXECUTOR_ELIGIBLE_MODELS,
  getExecutorEligibleModelIds,
  isExecutorEligible,
  isVLCapable,
  normalizeExecutorFallbackModel,
  normalizeExecutorModel,
} from "../../src/utils/executor-model-policy";

describe("OpenRouter model catalog", () => {
  const openRouterModels = [
    {
      id: "openai/gpt-5.6-luna",
      name: "GPT-5.6 Luna",
      promptPrice: 0.5 / 1_000_000,
      completionPrice: 3 / 1_000_000,
      supportsVision: true,
    },
    {
      id: "openai/gpt-5.4-mini",
      name: "GPT-5.4 Mini",
      promptPrice: 0.75 / 1_000_000,
      completionPrice: 4.5 / 1_000_000,
      supportsVision: true,
    },
    {
      id: "openai/gpt-oss-120b",
      name: "OpenAI GPT-OSS 120B",
      promptPrice: 0.15 / 1_000_000,
      completionPrice: 0.6 / 1_000_000,
      supportsVision: false,
    },
  ];

  test("executor eligibility policy: every eligible model is VL-capable and the default is eligible", () => {
    for (const model of EXECUTOR_ELIGIBLE_MODELS) {
      expect(isVLCapable(model)).toBe(true);
    }
    expect(isExecutorEligible(DEFAULT_EXECUTOR_MODEL)).toBe(true);
    expect([...getExecutorEligibleModelIds()]).toEqual([
      ...EXECUTOR_ELIGIBLE_MODELS,
    ]);
  });

  test("executor eligibility ignores routing suffixes and rejects text-only or foreign ids", () => {
    expect(isExecutorEligible("openai/gpt-6-luna:nitro")).toBe(true);
    expect(isExecutorEligible("openai/gpt-oss-120b")).toBe(false);
    expect(isExecutorEligible("kimi-k2.6")).toBe(false);
    expect(isExecutorEligible(undefined)).toBe(false);
  });

  test("normalizeExecutorModel keeps eligible ids and falls back to the default", () => {
    expect(normalizeExecutorModel(" moonshotai/kimi-k2.6 ")).toBe(
      "moonshotai/kimi-k2.6",
    );
    expect(normalizeExecutorModel("openai/gpt-oss-120b")).toBe(
      DEFAULT_EXECUTOR_MODEL,
    );
    expect(normalizeExecutorModel(undefined)).toBe(DEFAULT_EXECUTOR_MODEL);
  });

  test("normalizeExecutorFallbackModel falls back to the executor model", () => {
    expect(
      normalizeExecutorFallbackModel({
        executorModel: "minimax/minimax-m3",
        executorFallbackModel: "openai/gpt-oss-120b",
      }),
    ).toBe("minimax/minimax-m3");
    expect(
      normalizeExecutorFallbackModel({
        executorModel: "minimax/minimax-m3",
        executorFallbackModel: "moonshotai/kimi-k2.6",
      }),
    ).toBe("moonshotai/kimi-k2.6");
  });

  test("executor picker never offers a text-only model", () => {
    const options = getProviderModelOptions({
      role: "executor",
      openRouterModels,
    });
    for (const option of options) {
      expect(
        option.supportsVision,
        `executor picker offered text-only ${option.id}`,
      ).toBe(true);
    }
  });

  test("OpenRouter can seat the vision-and-tools Luna route as executor", () => {
    expect(isExecutorEligible("openai/gpt-5.6-luna")).toBe(true);
    expect(isVLCapable("openai/gpt-5.6-luna")).toBe(true);
    expect(
      getProviderModelOptions({ role: "executor", openRouterModels }).map(
        (model) => model.id,
      ),
    ).toContain("openai/gpt-5.6-luna");
  });

  test("OpenRouter can seat the multimodal tool-capable Ox Alpha route as executor", () => {
    expect(isExecutorEligible("stealth/ox-alpha")).toBe(true);
    expect(isVLCapable("stealth/ox-alpha")).toBe(true);
  });

  test("executor uses live multimodal OpenRouter models", () => {
    expect(
      getProviderModelOptions({ role: "executor", openRouterModels }),
    ).toEqual(openRouterModels.slice(0, 2));
  });

  test("planner and writer choices use the whole live catalog", () => {
    for (const role of ["planner", "writer"] as const) {
      expect(getProviderModelOptions({ role, openRouterModels })).toEqual(
        openRouterModels,
      );
    }
  });

  test("price formatting", () => {
    expect(formatPrice(0)).toBe("$0.00");
    expect(formatPrice(0.001 / 1_000_000)).toBe("<$0.01");
    expect(formatPricingBadge(openRouterModels[0])).toBe("$0.50 / $3.00 per 1M");
  });

  test("catalog note explains missing OpenRouter key for executor browsing", () => {
    expect(
      getProviderModelCatalogNote({ role: "executor", hasOpenRouterKey: false }),
    ).toContain("OpenRouter key");
  });

  test("catalog note describes the live catalog when a key is present", () => {
    expect(
      getProviderModelCatalogNote({ role: "executor", hasOpenRouterKey: true }),
    ).toContain("multimodal executor");
    expect(
      getProviderModelCatalogNote({ role: "planner", hasOpenRouterKey: true }),
    ).toContain("provider pricing");
    expect(
      getProviderModelCatalogNote({ role: "writer", hasOpenRouterKey: true }),
    ).toContain("Optional");
  });
});
