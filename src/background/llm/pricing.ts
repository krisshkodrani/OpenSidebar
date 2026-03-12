import { ProviderConfig, TokenUsage } from "./types";

export interface ModelPricing {
  providerId: ProviderConfig["providerId"];
  model: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cachedInputUsdPerMillion?: number;
  effectiveDate: string;
  sourceUrl: string;
  confidence: "official" | "best_effort";
}

const MODEL_PRICING: ModelPricing[] = [
  {
    providerId: "openrouter",
    model: "openai/gpt-oss-120b",
    inputUsdPerMillion: 0.039,
    outputUsdPerMillion: 0.19,
    effectiveDate: "2026-02-18",
    sourceUrl: "https://openrouter.ai/openai/gpt-oss-120b",
    confidence: "official",
  },
  {
    providerId: "openrouter",
    model: "minimax/minimax-m2.5",
    inputUsdPerMillion: 0.27,
    outputUsdPerMillion: 0.95,
    effectiveDate: "2026-03-11",
    sourceUrl: "https://openrouter.ai/minimax/minimax-m2.5",
    confidence: "official",
  },
  {
    providerId: "openrouter",
    model: "google/gemini-2.5-flash-lite",
    inputUsdPerMillion: 0.0,
    outputUsdPerMillion: 0.0,
    effectiveDate: "2026-03-11",
    sourceUrl: "https://openrouter.ai/google/gemini-2.5-flash-lite",
    confidence: "best_effort",
  },
  {
    providerId: "openrouter",
    model: "google/gemini-2.5-flash",
    inputUsdPerMillion: 0.15,
    outputUsdPerMillion: 0.60,
    effectiveDate: "2026-03-11",
    sourceUrl: "https://openrouter.ai/google/gemini-2.5-flash",
    confidence: "official",
  },
];

function normalizeModel(model: string): string {
  return model.trim().toLowerCase();
}

export function findModelPricing(
  providerId: ProviderConfig["providerId"],
  model: string,
): ModelPricing | null {
  const normalizedModel = normalizeModel(model);
  // Also try without :nitro suffix — nitro routing doesn't change pricing
  const baseModel = normalizedModel.replace(/:nitro$/, "");
  return (
    MODEL_PRICING.find(
      (entry) =>
        entry.providerId === providerId &&
        (normalizeModel(entry.model) === normalizedModel ||
          normalizeModel(entry.model) === baseModel),
    ) ?? null
  );
}

export function estimateCostUsd(
  providerId: ProviderConfig["providerId"],
  model: string,
  usage: TokenUsage,
): number | null {
  const pricing = findModelPricing(providerId, model);
  if (!pricing) return null;

  const promptTokens = Math.max(usage.prompt_tokens ?? 0, 0);
  const completionTokens = Math.max(usage.completion_tokens ?? 0, 0);
  const cachedTokens = Math.max(
    Math.min(usage.cached_tokens ?? 0, promptTokens),
    0,
  );
  const nonCachedPromptTokens = Math.max(promptTokens - cachedTokens, 0);
  const cachedRate =
    pricing.cachedInputUsdPerMillion ?? pricing.inputUsdPerMillion;

  const cost =
    (nonCachedPromptTokens / 1_000_000) * pricing.inputUsdPerMillion +
    (cachedTokens / 1_000_000) * cachedRate +
    (completionTokens / 1_000_000) * pricing.outputUsdPerMillion;

  return Number.isFinite(cost) ? cost : null;
}
