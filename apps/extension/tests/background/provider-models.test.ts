import { describe, expect, test } from "vitest";
import "../setup";
import {
  FIREWORKS_MODELS,
  GROQ_MODELS,
  MOONSHOT_MODELS,
  getProviderModelCatalogNote,
  getProviderModelOptions,
} from "../../src/sidepanel/hooks/useOpenRouterModels";

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
  ];

  test("fireworks mode uses curated Fireworks models for executor", () => {
    expect(
      getProviderModelOptions({
        providerMode: "fireworks",
        role: "executor",
        openRouterModels,
      }),
    ).toEqual(FIREWORKS_MODELS);
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

  test("openrouter executor uses live OpenRouter models", () => {
    expect(
      getProviderModelOptions({
        providerMode: "openrouter",
        role: "executor",
        openRouterModels,
      }),
    ).toEqual(openRouterModels);
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
});
