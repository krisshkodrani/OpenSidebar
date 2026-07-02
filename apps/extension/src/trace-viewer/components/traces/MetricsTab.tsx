import React, { useEffect, useMemo, useState } from "react";
import {
  fetchTraceIndexStatus,
  type TraceIndexStatus,
  type TraceInsightsQuery,
} from "../../api";
import { useStore } from "../../store";
import { useInsightsData } from "../../hooks/useInsightsData";
import { useTrendData } from "../../hooks/useTrendData";
import TrendChart from "./TrendChart";
import {
  formatCount,
  formatCost,
  formatDuration,
  formatPercent,
  formatTokens,
} from "../../utils";
import LoadingSpinner from "../LoadingSpinner";


function formatIndexedAt(value: number | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function rateConfidenceInterval(
  successes: number,
  total: number,
): { low: number; high: number } {
  if (total <= 0) return { low: 0, high: 0 };
  const z = 1.96;
  const phat = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = phat + z2 / (2 * total);
  const margin =
    z *
    Math.sqrt((phat * (1 - phat) + z2 / (4 * total)) / total);
  return {
    low: Math.max(0, (center - margin) / denominator),
    high: Math.min(1, (center + margin) / denominator),
  };
}

function formatRateRange(successes: number, total: number): string {
  const ci = rateConfidenceInterval(successes, total);
  return `${formatPercent(ci.low)}-${formatPercent(ci.high)}`;
}

function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: "neutral" | "warning" | "error" | "success";
}) {
  const toneClass =
    tone === "error"
      ? "text-state-error"
      : tone === "warning"
        ? "text-state-warning"
        : tone === "success"
          ? "text-state-success"
          : "text-trace-text";
  return (
    <div className="rounded border border-trace-border bg-trace-panel px-3 py-2 min-w-0">
      <div className="text-[10px] uppercase tracking-[0.18em] text-trace-muted">
        {label}
      </div>
      <div className={`mt-1 text-lg font-semibold ${toneClass}`}>{value}</div>
      {detail && (
        <div className="mt-1 text-[11px] text-trace-muted truncate">
          {detail}
        </div>
      )}
    </div>
  );
}

export default function MetricsTab() {
  const filters = useStore((s) => s.filters);
  const requestFilters = useMemo<TraceInsightsQuery>(
    () => ({
      outcome: filters.outcome,
      day: filters.day,
      from: filters.from,
      to: filters.to,
      domain: filters.domain,
      model: filters.model,
      runId: filters.runId,
      skill: filters.skill,
    }),
    [
      filters.day,
      filters.domain,
      filters.from,
      filters.model,
      filters.outcome,
      filters.runId,
      filters.skill,
      filters.to,
    ],
  );

  const { insights, loading, error } = useInsightsData(requestFilters);
  const { points: trendPoints, loading: trendLoading } =
    useTrendData(requestFilters);
  const [indexStatus, setIndexStatus] = useState<TraceIndexStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTraceIndexStatus()
      .then((result) => {
        if (!cancelled) setIndexStatus(result);
      })
      .catch(() => {
        if (!cancelled) setIndexStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = insights.summary;
  const requestCost = summary.requestCost || summary.totalCost;
  const estimatedRequestCost = summary.estimatedRequestCost || requestCost;
  const costSourceDetail =
    summary.unpricedRequests > 0
      ? `${formatCount(summary.unpricedRequests)} unpriced requests`
      : "Estimated from local pricing";

  return (
    <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-5 py-4">
      {loading ? (
        <LoadingSpinner message="Loading metrics..." />
      ) : error ? (
        <div className="rounded border border-state-error/25 bg-state-error/10 px-3 py-2 text-sm text-state-error">
          Failed to load metrics: {error}
        </div>
      ) : (
        <div className="space-y-4">
          {indexStatus && (
            <section>
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-trace-muted">
                  Trace Index
                </div>
                <div className="text-[11px] text-trace-muted">
                  Source: {indexStatus.source}
                </div>
              </div>
              <div className="grid grid-cols-2 xl:grid-cols-5 gap-2">
                <MetricCard
                  label="Indexed Traces"
                  value={formatCount(indexStatus.sessions)}
                  detail={`${formatCount(indexStatus.hotSessions)} hot, ${formatCount(indexStatus.archivedSessions)} archived`}
                  tone={indexStatus.available ? "success" : "warning"}
                />
                <MetricCard
                  label="Indexed Turns"
                  value={formatCount(indexStatus.turns)}
                  detail={`${formatCount(indexStatus.tools)} tool calls`}
                />
                <MetricCard
                  label="Artifacts"
                  value={formatCount(indexStatus.screenshots)}
                  detail={`${formatCount(indexStatus.runEvents)} run events`}
                />
                <MetricCard
                  label="Trace Range"
                  value={indexStatus.newestSessionDay ?? "-"}
                  detail={indexStatus.oldestSessionDay ?? "No indexed dates"}
                />
                <MetricCard
                  label="Last Indexed"
                  value={formatIndexedAt(indexStatus.indexedAt)}
                  detail={`${indexStatus.hotTraceDays} day hot policy`}
                />
              </div>
            </section>
          )}

          <section>
            <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-trace-muted">
              Request Volume
            </div>
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
              <MetricCard
                label="LLM Requests"
                value={formatCount(summary.llmRequests)}
                detail={`${formatCount(summary.totalSessions)} traces, ${formatCount(summary.totalRuns)} runs`}
              />
              <MetricCard
                label="Total Turns"
                value={formatCount(summary.totalTurns)}
                detail={`${summary.averageTurns.toFixed(1)} avg turns/trace, n=${formatCount(summary.totalSessions)}`}
              />
              <MetricCard
                label="Success Rate"
                value={formatPercent(summary.successRate)}
                detail={`n=${formatCount(summary.totalSessions)}, ${formatRateRange(summary.completedSessions, summary.totalSessions)}`}
                tone={summary.failedSessions > 0 ? "warning" : "success"}
              />
              <MetricCard
                label="Tool Failure Rate"
                value={formatPercent(summary.toolFailureRate)}
                detail={`n=${formatCount(summary.toolCalls)}, ${formatRateRange(summary.toolFailures, summary.toolCalls)}`}
                tone={summary.toolFailures > 0 ? "warning" : "success"}
              />
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-trace-muted">
                Trends Over Time
              </div>
              <div className="text-[11px] text-trace-muted">
                Success rate and estimated cost per day
              </div>
            </div>
            {trendLoading && trendPoints.length === 0 ? (
              <LoadingSpinner message="Loading trends..." />
            ) : (
              <TrendChart points={trendPoints} />
            )}
          </section>

          <section>
            <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-trace-muted">
              Token And Cost Usage
            </div>
            <div className="grid grid-cols-2 xl:grid-cols-5 gap-2">
              <MetricCard
                label="Input Tokens"
                value={formatTokens(summary.promptTokens)}
                detail={`${formatTokens(summary.nonCachedInputTokens)} non-cached, ${formatTokens(summary.cachedTokens)} cached`}
              />
              <MetricCard
                label="Output Tokens"
                value={formatTokens(summary.completionTokens)}
                detail={`${formatPercent(summary.outputTokenShare)} of tokens`}
              />
              <MetricCard
                label="Total Tokens"
                value={formatTokens(summary.totalTokens)}
                detail={`${formatTokens(Math.round(summary.averageTotalTokens))} avg/request`}
              />
              <MetricCard
                label="Estimated Cost"
                value={formatCost(estimatedRequestCost) || "$0"}
                detail={costSourceDetail}
                tone={summary.unpricedRequests > 0 ? "warning" : "neutral"}
              />
              <MetricCard
                label="Avg LLM Latency"
                value={formatDuration(summary.averageLlmDurationMs)}
                detail={`${formatDuration(summary.totalLlmDurationMs)} total`}
              />
            </div>
          </section>

          <section>
            <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-trace-muted">
              Cost Drivers
            </div>
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
              <MetricCard
                label="Input Cost"
                value={formatCost(summary.estimatedInputCost) || "$0"}
                detail={`${formatTokens(summary.nonCachedInputTokens)} non-cached input`}
              />
              <MetricCard
                label="Cached Input Cost"
                value={formatCost(summary.estimatedCachedInputCost) || "$0"}
                detail={`${formatTokens(summary.cachedTokens)} cached input`}
              />
              <MetricCard
                label="Output Cost"
                value={formatCost(summary.estimatedOutputCost) || "$0"}
                detail={`${formatTokens(summary.completionTokens)} output tokens`}
              />
              <MetricCard
                label="Output Cost Share"
                value={formatPercent(summary.outputCostShare)}
                detail="Share of estimated request cost"
              />
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-trace-muted">
                Model Mix
              </div>
              <div className="text-[11px] text-trace-muted">
                Hot trace policy: 7 days before archive
              </div>
            </div>
            <div className="overflow-hidden rounded border border-trace-border bg-trace-bg">
              <div className="grid grid-cols-[minmax(180px,1.6fr)_70px_70px_80px_90px_90px_110px] gap-3 border-b border-trace-border px-3 py-2 text-[10px] uppercase tracking-wider text-trace-muted">
                <span>Model</span>
                <span>Traces</span>
                <span>Runs</span>
                <span>Requests</span>
                <span>Est. Cost</span>
                <span>Output Share</span>
                <span>Fail Rate (n)</span>
              </div>
              {insights.models.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-trace-muted">
                  No model metrics found for the current filters.
                </div>
              ) : (
                insights.models.slice(0, 12).map((row) => (
                  <div
                    key={row.id}
                    className="grid grid-cols-[minmax(180px,1.6fr)_70px_70px_80px_90px_90px_110px] gap-3 border-b border-trace-border/50 px-3 py-2 text-[12px] last:border-b-0"
                  >
                    <span className="min-w-0 truncate text-trace-text">
                      {row.label}
                    </span>
                    <span className="text-trace-subtle">
                      {formatCount(row.sessions)}
                    </span>
                    <span className="text-trace-subtle">
                      {formatCount(row.runs)}
                    </span>
                    <span className="text-trace-subtle">
                      {formatCount(row.requests ?? row.calls)}
                    </span>
                    <span className="text-trace-subtle">
                      {formatCost(
                        row.estimatedRequestCost ??
                          row.requestCost ??
                          row.totalCost,
                      ) || "-"}
                    </span>
                    <span className="text-trace-subtle">
                      {row.outputCostShare == null
                        ? "-"
                        : formatPercent(row.outputCostShare)}
                    </span>
                    <span className="text-trace-subtle">
                      {formatPercent(row.failureRate)} (
                      {formatCount(row.calls ?? row.requests ?? row.sessions)})
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
