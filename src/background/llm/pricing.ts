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
    model: "deepseek/deepseek-v3.2",
    inputUsdPerMillion: 0.25,
    outputUsdPerMillion: 0.40,
    effectiveDate: "2026-02-28",
    sourceUrl: "https://openrouter.ai/deepseek/deepseek-v3.2",
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
  return (
    MODEL_PRICING.find(
      (entry) =>
        entry.providerId === providerId &&
        normalizeModel(entry.model) === normalizedModel,
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
