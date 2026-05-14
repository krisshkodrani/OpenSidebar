import React from "react";
import type { SessionMetrics } from "../../../types";
import {
  formatCostCompact,
  formatTimeCompact,
  formatTokensCompact,
  resolveCostMode,
} from "../../message-formatting";

export function MetricsSummary({ metrics }: { metrics: SessionMetrics }) {
  const models = Object.entries(metrics.modelBreakdown);
  const showBreakdown = models.length > 1;
  const costMode = resolveCostMode(metrics);
  const perceptionDecision = metrics.perceptionModeDecision;

  return (
    <div className="space-y-0.5 text-xs tabular-nums text-warm-500 dark:text-warm-400">
      <div className="flex flex-wrap items-center gap-1.5">
        <span>{formatTokensCompact(metrics.totalTokens)} tokens</span>
        <span className="text-warm-300 dark:text-warm-600">/</span>
        <span>
          {metrics.totalCost > 0 ? formatCostCompact(metrics.totalCost) : "--"}
          {metrics.totalCost > 0 && costMode === "estimated" ? " (est.)" : ""}
          {metrics.totalCost > 0 && costMode === "mixed" ? " (mixed)" : ""}
        </span>
        <span className="text-warm-300 dark:text-warm-600">/</span>
        <span>LLM {formatTimeCompact(metrics.totalLlmTimeMs)}</span>
        {(metrics.visionCallCount ?? 0) + (metrics.cachedVisionCallCount ?? 0) >
          0 && (
          <>
            <span className="text-warm-300 dark:text-warm-600">/</span>
            <span>
              Vision {metrics.visionCallCount ?? 0}
              {(metrics.cachedVisionCallCount ?? 0) > 0
                ? ` +${metrics.cachedVisionCallCount} cached`
                : ""}
            </span>
          </>
        )}
        <span className="text-warm-300 dark:text-warm-600">/</span>
        <span>
          Total {formatTimeCompact(metrics.totalSessionTimeMs)}
          {(metrics.imagePromptCount ?? 0) > 0
            ? `, Images ${metrics.imagePromptCount}${
                (metrics.totalImagePromptTokenEstimate ?? 0) > 0
                  ? ` (~${formatTokensCompact(
                      metrics.totalImagePromptTokenEstimate ?? 0,
                    )} tok)`
                  : ""
              }`
            : ""}
        </span>
      </div>
      {perceptionDecision ? (
        <div>
          Perception {perceptionDecision.mode} / {perceptionDecision.reason}
        </div>
      ) : null}
      {showBreakdown ? (
        <div className="space-y-0.5 pl-2">
          {models.map(([model, data]) => (
            <div key={model} className="flex items-center gap-1.5">
              <span className="text-warm-400 dark:text-warm-500">
                {model.split("/").pop()}:
              </span>
              <span>
                {formatTokensCompact(data.promptTokens + data.completionTokens)}{" "}
                tok
              </span>
              {data.cost > 0 ? (
                <>
                  <span className="text-warm-300 dark:text-warm-600">/</span>
                  <span>{formatCostCompact(data.cost)}</span>
                </>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
