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

  return (
    <div className="px-4 py-1 text-xs text-gray-500 dark:text-gray-400 tabular-nums flex items-center gap-2 flex-wrap">
      <span>{formatTokens(metrics.totalTokens)} tokens</span>
      <span className="text-gray-300 dark:text-gray-600">·</span>
      {hasCost ? (
        <span>{formatCost(metrics.totalCost)}</span>
      ) : (
        <span>—</span>
      )}
      <span className="text-gray-300 dark:text-gray-600">·</span>
      <span>{formatTime(metrics.totalLlmTimeMs)} LLM</span>
    </div>
  );
}
