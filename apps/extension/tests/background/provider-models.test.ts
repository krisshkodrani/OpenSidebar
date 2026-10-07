import { describe, expect, test } from "vitest";
import "../setup";
import {
  formatPrice,
  formatPricingBadge,
  getProviderModelCatalogNote,
  getProviderModelOptions,
} from "../../src/sidepanel/hooks/useOpenRouterModels";
import {
  EXECUTOR_ELIGIBLE_MODELS,
  getDefaultExecutorModel,
  isExecutorEligible,
  isVLCapable,
} from "../../src/utils/executor-model-policy";

describe("provider-scoped model catalogs", () => {
  const openRouterModels = [
    {
      id: "openai/gpt-5.6-luna",
      name: "GPT-5.6 Luna",
      promptPrice: 0.5 / 1_000_000,
      completionPrice: 3 / 1_000_000,
      supportsVision: true,
      provider: "openrouter" as const,
      source: "live" as const,
    },
    {
      id: "openai/gpt-5.4-mini",
      name: "GPT-5.4 Mini",
      promptPrice: 0.75 / 1_000_000,
      completionPrice: 4.5 / 1_000_000,
      supportsVision: true,
      provider: "openrouter" as const,
      source: "live" as const,
    },
    {
      id: "openai/gpt-oss-120b",
      name: "OpenAI GPT-OSS 120B",
      promptPrice: 0.15 / 1_000_000,
      completionPrice: 0.6 / 1_000_000,
      supportsVision: false,
      provider: "openrouter" as const,
      source: "live" as const,
    },
  ];

  test("OpenRouter can seat the vision-and-tools Luna route as executor", () => {
    expect(isExecutorEligible("openai/gpt-5.6-luna", "openrouter")).toBe(true);
    expect(isVLCapable("openai/gpt-5.6-luna")).toBe(true);
    expect(
      getProviderModelOptions({
        providerMode: "openrouter",
        role: "executor",
        openRouterModels,
      }).map((model) => model.id),
    ).toContain("openai/gpt-5.6-luna");
  });

  test("OpenRouter can seat the multimodal tool-capable Ox Alpha route as executor", () => {
    expect(isExecutorEligible("stealth/ox-alpha", "openrouter")).toBe(true);
    expect(isVLCapable("stealth/ox-alpha")).toBe(true);
  });

  test("openrouter executor uses live multimodal OpenRouter models", () => {
    expect(
      getProviderModelOptions({
        providerMode: "openrouter",
        role: "executor",
        openRouterModels,
      }),
    ).toEqual(openRouterModels.slice(0, 2));
  });

  test("unknown curated pricing is not presented as free", () => {
    expect(formatPricingBadge({...openRouterModels[0],pricingKnown:false})).toBe("Pricing unavailable");
    expect(formatPrice(0)).toBe("$0.00");
    expect(formatPrice(0.001 / 1_000_000)).toBe("<$0.01");
  });
});
