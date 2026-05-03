import { Citation, SessionMetrics, ToolName } from "../../types";
import type { PerceptionRuntimeModeDecision } from "../../utils/perception-mode";
import { estimateCostUsd } from "../llm/pricing";
import { CompletionResponse, ProviderConfig, TokenUsage } from "../llm/types";

type CostMode = "none" | "actual" | "estimated" | "mixed";

export function emptySessionMetrics(): SessionMetrics {
  return {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    totalCostActual: 0,
    totalCostEstimated: 0,
    costMode: "none",
    totalLlmTimeMs: 0,
    totalSessionTimeMs: 0,
    llmCallCount: 0,
    visionCallCount: 0,
    cachedVisionCallCount: 0,
    totalCachedTokens: 0,
    modelBreakdown: {},
  };
}

function deriveCostMode(actualCost: number, estimatedCost: number): CostMode {
  if (actualCost <= 0 && estimatedCost <= 0) return "none";
  if (actualCost > 0 && estimatedCost > 0) return "mixed";
  if (actualCost > 0) return "actual";
  return "estimated";
}

function resolveUsageCost(
  usage: TokenUsage,
  providerId: ProviderConfig["providerId"],
  model: string,
): { total: number; actual: number; estimated: number } {
  // Always use static pricing table for consistent cost across all providers.
  const estimated = estimateCostUsd(providerId, model, usage) ?? 0;
  return { total: estimated, actual: 0, estimated };
}

function ensureModelBreakdownEntry(metrics: SessionMetrics, model: string) {
  if (!metrics.modelBreakdown[model]) {
    metrics.modelBreakdown[model] = {
      promptTokens: 0,
      completionTokens: 0,
      cost: 0,
      actualCost: 0,
      estimatedCost: 0,
      costMode: "none",
      calls: 0,
    };
  }
  return metrics.modelBreakdown[model];
}

export function recordCompletionUsage(args: {
  metrics: SessionMetrics;
  response: CompletionResponse;
  llmMs: number;
  currentProvider: ProviderConfig["providerId"];
  currentModel: string;
  onCacheHit?: (cacheHit: {
    cached: number;
    prompt: number;
    pct: number;
  }) => void;
}): void {
  const { metrics, response, llmMs } = args;
  if (response.usage) {
    metrics.totalPromptTokens += response.usage.prompt_tokens;
    metrics.totalCompletionTokens += response.usage.completion_tokens;
    metrics.totalTokens += response.usage.total_tokens;
    const providerId = (response.actualProviderId ??
      args.currentProvider) as ProviderConfig["providerId"];
    const model = response.actualModel ?? args.currentModel;
    const cost = resolveUsageCost(response.usage, providerId, model);
    metrics.totalCost += cost.total;
    metrics.totalCostActual = (metrics.totalCostActual ?? 0) + cost.actual;
    metrics.totalCostEstimated =
      (metrics.totalCostEstimated ?? 0) + cost.estimated;
    metrics.costMode = deriveCostMode(
      metrics.totalCostActual ?? 0,
      metrics.totalCostEstimated ?? 0,
    );
    if (response.usage.cached_tokens) {
      metrics.totalCachedTokens += response.usage.cached_tokens;
      args.onCacheHit?.({
        cached: response.usage.cached_tokens,
        prompt: response.usage.prompt_tokens,
        pct: Math.round(
          (response.usage.cached_tokens / response.usage.prompt_tokens) * 100,
        ),
      });
    }
  }
  metrics.totalLlmTimeMs += llmMs;
  metrics.llmCallCount += 1;

  const model = response.actualModel ?? args.currentModel;
  const entry = ensureModelBreakdownEntry(metrics, model);
  entry.calls += 1;
  if (response.usage) {
    entry.promptTokens += response.usage.prompt_tokens;
    entry.completionTokens += response.usage.completion_tokens;
    const providerId = (response.actualProviderId ??
      args.currentProvider) as ProviderConfig["providerId"];
    const cost = resolveUsageCost(response.usage, providerId, model);
    entry.cost += cost.total;
    entry.actualCost = (entry.actualCost ?? 0) + cost.actual;
    entry.estimatedCost = (entry.estimatedCost ?? 0) + cost.estimated;
    entry.costMode = deriveCostMode(
      entry.actualCost ?? 0,
      entry.estimatedCost ?? 0,
    );
  }
}

export function recordVisionTelemetryUsage(args: {
  metrics: SessionMetrics;
  usage: TokenUsage;
  llmMs: number;
  model: string;
  providerId: ProviderConfig["providerId"];
}): void {
  const { metrics, usage, llmMs, model, providerId } = args;
  metrics.visionCallCount = (metrics.visionCallCount ?? 0) + 1;
  metrics.totalPromptTokens += usage.prompt_tokens;
  metrics.totalCompletionTokens += usage.completion_tokens;
  metrics.totalTokens += usage.total_tokens;
  const cost = resolveUsageCost(usage, providerId, model);
  metrics.totalCost += cost.total;
  metrics.totalCostActual = (metrics.totalCostActual ?? 0) + cost.actual;
  metrics.totalCostEstimated =
    (metrics.totalCostEstimated ?? 0) + cost.estimated;
  metrics.costMode = deriveCostMode(
    metrics.totalCostActual ?? 0,
    metrics.totalCostEstimated ?? 0,
  );
  metrics.totalLlmTimeMs += llmMs;
  metrics.llmCallCount += 1;

  const entry = ensureModelBreakdownEntry(metrics, model);
  entry.calls += 1;
  entry.promptTokens += usage.prompt_tokens;
  entry.completionTokens += usage.completion_tokens;
  entry.cost += cost.total;
  entry.actualCost = (entry.actualCost ?? 0) + cost.actual;
  entry.estimatedCost = (entry.estimatedCost ?? 0) + cost.estimated;
  entry.costMode = deriveCostMode(
    entry.actualCost ?? 0,
    entry.estimatedCost ?? 0,
  );
}

export function recordCachedVisionTelemetryUse(metrics: SessionMetrics): void {
  metrics.cachedVisionCallCount = (metrics.cachedVisionCallCount ?? 0) + 1;
}

export function recordPerceptionModeDecision(
  metrics: SessionMetrics,
  decision: PerceptionRuntimeModeDecision,
): void {
  metrics.perceptionModeDecision = {
    mode: decision.mode,
    reason: decision.reason,
    signals: [...decision.signals],
  };
}

export function recordTelemetryCitation(args: {
  citations: Citation[];
  citationUrls: Set<string>;
  url: string;
  title: string;
  tool: ToolName;
  turn: number;
}): void {
  try {
    const parsedUrl = new URL(args.url);
    const normalized = parsedUrl.origin + parsedUrl.pathname;
    if (args.citationUrls.has(normalized)) return;
    args.citationUrls.add(normalized);
    args.citations.push({
      url: args.url,
      title: args.title || args.url,
      tool: args.tool,
      turn: args.turn,
    });
  } catch {
    // Ignore malformed URLs.
  }
}
