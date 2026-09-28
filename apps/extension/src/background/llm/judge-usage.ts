import type { JudgeUsage } from "../agent/completion/judge";
import type { ProviderConfig, TokenUsage } from "./types";
import { estimateCostUsd } from "./pricing";

/** Prefer the charged provider amount; estimate only when it is unavailable. */
export function toJudgeUsage(
  usage: TokenUsage | undefined,
  providerId: ProviderConfig["providerId"],
  model: string,
): JudgeUsage | undefined {
  if (!usage) return undefined;
  const hasActualCost = typeof usage.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0;
  const costUsd = hasActualCost
    ? usage.cost
    : estimateCostUsd(providerId, model, usage);
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
    ...(usage.cached_tokens != null ? { cachedTokens: usage.cached_tokens } : {}),
    ...(costUsd != null ? { costUsd, costSource: hasActualCost ? "actual" as const : "estimated" as const } : {}),
  };
}
