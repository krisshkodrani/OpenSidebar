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
    providerId: "groq",
    model: "openai/gpt-oss-120b",
    inputUsdPerMillion: 0.15,
    outputUsdPerMillion: 0.6,
    cachedInputUsdPerMillion: 0.075,
    effectiveDate: "2026-04-19",
    sourceUrl: "https://console.groq.com/docs/model/openai/gpt-oss-120b",
    confidence: "official",
  },
  {
    providerId: "groq",
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    inputUsdPerMillion: 0.11,
    outputUsdPerMillion: 0.34,
    effectiveDate: "2026-04-19",
    sourceUrl:
      "https://console.groq.com/docs/model/meta-llama/llama-4-scout-17b-16e-instruct",
    confidence: "official",
  },
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
    inputUsdPerMillion: 0.118,
    outputUsdPerMillion: 0.99,
    effectiveDate: "2026-04-19",
    sourceUrl: "https://openrouter.ai/minimax/minimax-m2.5",
    confidence: "official",
  },
  {
    providerId: "openrouter",
    model: "google/gemini-2.5-flash-lite",
    inputUsdPerMillion: 0.1,
    outputUsdPerMillion: 0.4,
    effectiveDate: "2026-04-19",
    sourceUrl: "https://openrouter.ai/google/gemini-2.5-flash-lite",
    confidence: "official",
  },
  {
    providerId: "openrouter",
    model: "google/gemini-2.5-flash",
    inputUsdPerMillion: 0.3,
    outputUsdPerMillion: 2.5,
    effectiveDate: "2026-04-19",
    sourceUrl: "https://openrouter.ai/google/gemini-2.5-flash",
    confidence: "official",
  },
  {
    providerId: "fireworks",
    model: "openai/gpt-oss-120b",
    inputUsdPerMillion: 0.15,
    outputUsdPerMillion: 0.6,
    effectiveDate: "2026-04-19",
    sourceUrl: "https://fireworks.ai/pricing",
    confidence: "official",
  },
  {
    providerId: "fireworks",
    model: "qwen/qwen3-vl-30b-a3b-instruct",
    inputUsdPerMillion: 0.15,
    outputUsdPerMillion: 0.6,
    effectiveDate: "2026-04-19",
    sourceUrl: "https://fireworks.ai/pricing",
    confidence: "official",
  },
  {
    providerId: "fireworks",
    model: "accounts/fireworks/routers/kimi-k2p5-turbo",
    inputUsdPerMillion: 0.99,
    outputUsdPerMillion: 4.94,
    cachedInputUsdPerMillion: 0.16,
    effectiveDate: "2026-04-19",
    sourceUrl: "https://fireworks.ai/pricing",
    confidence: "official",
  },
  {
    providerId: "fireworks",
    model: "accounts/fireworks/routers/kimi-k2p5",
    inputUsdPerMillion: 0.6,
    outputUsdPerMillion: 3.0,
    cachedInputUsdPerMillion: 0.1,
    effectiveDate: "2026-04-19",
    sourceUrl: "https://fireworks.ai/pricing",
    confidence: "official",
  },
  {
    providerId: "fireworks",
    model: "accounts/fireworks/models/minimax-m2p5",
    inputUsdPerMillion: 0.3,
    outputUsdPerMillion: 1.2,
    cachedInputUsdPerMillion: 0.03,
    effectiveDate: "2026-04-19",
    sourceUrl: "https://fireworks.ai/pricing",
    confidence: "official",
  },
  {
    providerId: "openrouter",
    model: "openai/gpt-5.4-mini",
    inputUsdPerMillion: 0.75,
    outputUsdPerMillion: 4.5,
    effectiveDate: "2026-04-19",
    sourceUrl: "https://openrouter.ai/openai/gpt-5.4-mini",
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
