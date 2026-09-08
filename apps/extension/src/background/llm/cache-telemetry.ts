import { logger } from "../../utils";
import type { PromptCacheTelemetry, ProviderConfig, TokenUsage } from "./types";

function parsePositiveIntHeader(
  headers: Headers,
  name: string,
): number | undefined {
  const raw = headers.get(name);
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function readProviderCacheTelemetry(
  providerId: ProviderConfig["providerId"],
  headers: Headers,
): PromptCacheTelemetry | undefined {
  if (providerId !== "fireworks") return undefined;
  const promptTokens = parsePositiveIntHeader(
    headers,
    "fireworks-prompt-tokens",
  );
  const cachedPromptTokens = parsePositiveIntHeader(
    headers,
    "fireworks-cached-prompt-tokens",
  );
  if (promptTokens == null && cachedPromptTokens == null) {
    logger.debug("agent", "Fireworks cache telemetry headers absent");
    return undefined;
  }
  const cacheHitPct =
    promptTokens && cachedPromptTokens != null
      ? Math.round((cachedPromptTokens / promptTokens) * 10000) / 100
      : undefined;
  return {
    provider: providerId,
    promptTokens,
    cachedPromptTokens,
    cacheHitPct,
    source: "response_headers",
  };
}

export function mergeCacheTelemetry(
  usage: TokenUsage | undefined,
  telemetry: PromptCacheTelemetry | undefined,
): TokenUsage | undefined {
  if (!usage || !telemetry) return usage;
  const promptTokens = telemetry.promptTokens ?? usage.prompt_tokens;
  const cachedTokens = telemetry.cachedPromptTokens ?? usage.cached_tokens;
  return {
    ...usage,
    prompt_tokens: promptTokens,
    cached_tokens: cachedTokens,
    cacheTelemetry: {
      ...telemetry,
      promptTokens,
      cachedPromptTokens: cachedTokens,
      cacheHitPct:
        promptTokens > 0 && cachedTokens != null
          ? Math.round((cachedTokens / promptTokens) * 10000) / 100
          : telemetry.cacheHitPct,
    },
  };
}

export function withUsageCacheTelemetry(
  usage: TokenUsage | undefined,
  providerId: ProviderConfig["providerId"],
): TokenUsage | undefined {
  if (!usage || usage.cached_tokens == null) return usage;
  const cacheHitPct =
    usage.prompt_tokens > 0
      ? Math.round((usage.cached_tokens / usage.prompt_tokens) * 10000) / 100
      : undefined;
  return {
    ...usage,
    cacheTelemetry: {
      provider: providerId,
      promptTokens: usage.prompt_tokens,
      cachedPromptTokens: usage.cached_tokens,
      cacheHitPct,
      source: "usage",
    },
  };
}
