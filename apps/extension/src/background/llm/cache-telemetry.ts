import type { ProviderConfig, TokenUsage } from "./types";

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
