import { ProviderConfig, TokenUsage } from "./types";
import { DEFAULT_MODEL_PRICING } from "./pricing-data";

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
    DEFAULT_MODEL_PRICING.find(
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
