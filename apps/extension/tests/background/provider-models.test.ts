import { describe, expect, test } from "vitest";
import "../setup";
import {
  DEEPSEEK_MODELS,
  FIREWORKS_MODELS,
  GROQ_MODELS,
  MOONSHOT_MODELS,
  XIAOMI_MODELS,
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

  test("fireworks mode uses multimodal Fireworks models for executor", () => {
    expect(
      getProviderModelOptions({
        providerMode: "fireworks",
        role: "executor",
        openRouterModels,
      }),
    ).toEqual(
      FIREWORKS_MODELS.filter(
        (model) =>
          model.id === "accounts/fireworks/models/kimi-k2p7-code" ||
          model.id === "accounts/fireworks/routers/kimi-k2p6-turbo" ||
          model.id === "accounts/fireworks/routers/kimi-k2p5-turbo" ||
          model.id === "qwen/qwen3-vl-30b-a3b-instruct",
      ),
    );
  });

  test("fireworks Kimi K2.7 Code is the default vision-capable executor with official pricing", () => {
    const model = FIREWORKS_MODELS.find(
      (candidate) =>
        candidate.id === "accounts/fireworks/models/kimi-k2p7-code",
    );

    expect(model).toMatchObject({
      name: "Kimi K2.7 Code",
      promptPrice: 0.95 / 1_000_000,
      completionPrice: 4.0 / 1_000_000,
      supportsVision: true,
      effectiveDate: "2026-06-12",
      source: "curated",
      provider: "fireworks",
    });
    expect(
      isExecutorEligible(
        "accounts/fireworks/models/kimi-k2p7-code",
        "fireworks",
      ),
    ).toBe(true);
    expect(isVLCapable("accounts/fireworks/models/kimi-k2p7-code")).toBe(true);
    expect(getDefaultExecutorModel("fireworks")).toBe(
      "accounts/fireworks/models/kimi-k2p7-code",
    );
  });

  test("executor eligibility policy: every eligible model is VL-capable and every default is eligible", () => {
    for (const model of EXECUTOR_ELIGIBLE_MODELS) {
      expect(isVLCapable(model)).toBe(true);
    }
    const providerModes = [
      "openrouter",
      "openrouter-groq",
      "openai-groq",
      "fireworks",
      "fireworks-deepseek",
      "moonshot",
      "xiaomi",
    ] as const;
    for (const providerMode of providerModes) {
      const fallback = getDefaultExecutorModel(providerMode);
      expect(isExecutorEligible(fallback, providerMode)).toBe(true);
    }
  });

  test("executor picker never offers a text-only model in any provider mode", () => {
    const providerModes = [
      "openrouter",
      "openrouter-groq",
      "openai-groq",
      "fireworks",
      "fireworks-deepseek",
      "moonshot",
      "xiaomi",
    ] as const;
    for (const providerMode of providerModes) {
      const options = getProviderModelOptions({
        providerMode,
        role: "executor",
        openRouterModels,
      });
      for (const option of options) {
        expect(
          option.supportsVision,
          `${providerMode} executor picker offered text-only ${option.id}`,
        ).toBe(true);
      }
    }
  });

  test("fireworks Kimi K2.6 Turbo catalog pricing matches Fireworks serverless pricing", () => {
    expect(
      FIREWORKS_MODELS.find(
        (model) => model.id === "accounts/fireworks/routers/kimi-k2p6-turbo",
      ),
    ).toMatchObject({
      name: "Kimi K2.6 Turbo",
      promptPrice: 2.0 / 1_000_000,
      completionPrice: 8.0 / 1_000_000,
      effectiveDate: "2026-05-29",
      source: "curated",
      provider: "fireworks",
    });
  });

  test("openrouter-groq planner uses curated Groq models", () => {
    expect(
      getProviderModelOptions({
        providerMode: "openrouter-groq",
        role: "planner",
        openRouterModels,
      }),
    ).toEqual(GROQ_MODELS);
  });

  test("fireworks-deepseek executor uses multimodal Fireworks models", () => {
    expect(
      getProviderModelOptions({
        providerMode: "fireworks-deepseek",
        role: "executor",
        openRouterModels,
      }),
    ).toEqual(
      FIREWORKS_MODELS.filter(
        (model) =>
          model.id === "accounts/fireworks/models/kimi-k2p7-code" ||
          model.id === "accounts/fireworks/routers/kimi-k2p6-turbo" ||
          model.id === "accounts/fireworks/routers/kimi-k2p5-turbo" ||
          model.id === "qwen/qwen3-vl-30b-a3b-instruct",
      ),
    );
  });

  test("fireworks-deepseek planner uses curated DeepSeek models", () => {
    expect(
      getProviderModelOptions({
        providerMode: "fireworks-deepseek",
        role: "planner",
        openRouterModels,
      }),
    ).toEqual(DEEPSEEK_MODELS);
  });

  test("openrouter executor uses live multimodal OpenRouter models", () => {
    expect(
      getProviderModelOptions({
        providerMode: "openrouter",
        role: "executor",
        openRouterModels,
      }),
    ).toEqual([openRouterModels[0]]);
  });

  test("moonshot mode uses curated Moonshot models for executor", () => {
    expect(
      getProviderModelOptions({
        providerMode: "moonshot",
        role: "executor",
        openRouterModels,
      }),
    ).toEqual(MOONSHOT_MODELS);
  });

  test("xiaomi mode uses MiMo Omni for executor and curated MiMo models for planner", () => {
    expect(
      getProviderModelOptions({
        providerMode: "xiaomi",
        role: "executor",
        openRouterModels,
      }),
    ).toEqual([XIAOMI_MODELS[0]]);

    expect(
      getProviderModelOptions({
        providerMode: "xiaomi",
        role: "planner",
        openRouterModels,
      }),
    ).toEqual(XIAOMI_MODELS);
  });

  test("xiaomi executor policy accepts MiMo Omni and rejects unrelated models", () => {
    expect(getDefaultExecutorModel("xiaomi")).toBe("mimo-v2-omni");
    expect(isExecutorEligible("mimo-v2-omni", "xiaomi")).toBe(true);
    expect(isExecutorEligible("mimo-v2-pro", "xiaomi")).toBe(false);
    expect(
      isExecutorEligible(
        "accounts/fireworks/routers/kimi-k2p5-turbo",
        "xiaomi",
      ),
    ).toBe(false);
  });

  test("catalog note explains missing OpenRouter key for executor browsing", () => {
    expect(
      getProviderModelCatalogNote({
        providerMode: "openrouter-groq",
        role: "executor",
        hasOpenRouterKey: false,
      }),
    ).toContain("OpenRouter key");
  });

  test("moonshot catalog note explains curated pricing", () => {
    expect(
      getProviderModelCatalogNote({
        providerMode: "moonshot",
        role: "planner",
        hasOpenRouterKey: false,
      }),
    ).toContain("Moonshot");
  });

  test("xiaomi catalog note explains unknown pricing", () => {
    expect(
      getProviderModelCatalogNote({
        providerMode: "xiaomi",
        role: "planner",
        hasOpenRouterKey: false,
      }),
    ).toContain("Pricing is unknown");
  });

  test("fireworks-deepseek catalog note explains planner provider", () => {
    expect(
      getProviderModelCatalogNote({
        providerMode: "fireworks-deepseek",
        role: "planner",
        hasOpenRouterKey: false,
      }),
    ).toContain("DeepSeek");
  });
});
