import React from "react";
import { SessionMetrics } from "../../types";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(cost: number): string {
  if (cost === 0) return "$0";
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  if (cost >= 0.01) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(4)}`;
}

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

export function MetricsBar({ metrics }: { metrics: SessionMetrics }) {
  const hasCost = metrics.totalCost > 0;
  const cacheRate =
    metrics.totalCachedTokens > 0 && metrics.totalPromptTokens > 0
      ? Math.round(
          (metrics.totalCachedTokens / metrics.totalPromptTokens) * 100,
        )
      : 0;
  const tokPerSec =
    metrics.totalCompletionTokens > 0 && metrics.totalLlmTimeMs > 0
      ? Math.round(
          (metrics.totalCompletionTokens / metrics.totalLlmTimeMs) * 1000,
        )
      : 0;

  return (
    <div className="px-4 py-1 text-xs text-warm-500 dark:text-warm-400 tabular-nums flex items-center gap-2 flex-wrap">
      <span>{formatTokens(metrics.totalTokens)} tokens</span>
      <span className="text-warm-300 dark:text-warm-600">·</span>
      {hasCost ? <span>{formatCost(metrics.totalCost)}</span> : <span>—</span>}
      <span className="text-warm-300 dark:text-warm-600">·</span>
      <span>{formatTime(metrics.totalLlmTimeMs)} LLM</span>
      {tokPerSec > 0 && (
        <>
          <span className="text-warm-300 dark:text-warm-600">·</span>
          <span>{tokPerSec} tok/s</span>
        </>
      )}
      {cacheRate > 0 && (
        <>
          <span className="text-warm-300 dark:text-warm-600">·</span>
          <span className="text-green-600 dark:text-green-400">
            {cacheRate}% cached
          </span>
        </>
      )}
    </div>
  );
}
