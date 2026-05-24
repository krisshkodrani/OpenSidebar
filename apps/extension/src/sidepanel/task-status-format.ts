import type { SessionMetrics } from "../types";

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(cost: number): string {
  if (cost === 0) return "$0";
  if (cost >= 0.01) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(4)}`;
}

export function costLabel(metrics: SessionMetrics): string {
  const mode =
    metrics.costMode ??
    (metrics.totalCost > 0
      ? (metrics.totalCostEstimated ?? 0) > 0 &&
        (metrics.totalCostActual ?? 0) > 0
        ? "mixed"
        : (metrics.totalCostEstimated ?? 0) > 0
          ? "estimated"
          : "actual"
      : "none");
  const suffix = mode === "estimated" ? " est." : mode === "mixed" ? " ~" : "";
  return `${formatCost(metrics.totalCost)}${suffix}`;
}
