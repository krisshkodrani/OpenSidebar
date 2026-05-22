import React, { useEffect, useMemo, useState } from "react";
import {
  fetchTraceIndexStatus,
  fetchTraceInsights,
  type TraceIndexStatus,
  type TraceInsightsQuery,
  type TraceInsightsResponse,
} from "../../api";
import { useStore } from "../../store";
import {
  formatCount,
  formatCost,
  formatDuration,
  formatPercent,
  formatTokens,
} from "../../utils";
import LoadingSpinner from "../LoadingSpinner";

const METRICS_TIMEOUT_MS = 30_000;

function emptyInsights(): TraceInsightsResponse {
  return {
    summary: {
      totalSessions: 0,
      totalRuns: 0,
      completedSessions: 0,
      failedSessions: 0,
      successRate: 0,
      failureRate: 0,
      totalTurns: 0,
      averageTurns: 0,
      totalCost: 0,
      averageDurationMs: 0,
      toolCalls: 0,
      toolFailures: 0,
      toolFailureRate: 0,
      llmRequests: 0,
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      nonCachedInputTokens: 0,
      totalTokens: 0,
      requestCost: 0,
      estimatedInputCost: 0,
      estimatedCachedInputCost: 0,
      estimatedOutputCost: 0,
      estimatedRequestCost: 0,
      outputTokenShare: 0,
      outputCostShare: 0,
      unpricedRequests: 0,
      averagePromptTokens: 0,
      averageCompletionTokens: 0,
      averageTotalTokens: 0,
      totalLlmDurationMs: 0,
      averageLlmDurationMs: 0,
    },
    facets: {
      runs: [],
      sessions: [],
      domains: [],
      models: [],
      skills: [],
      tools: [],
      failures: [],
      eventTypes: [],
    },
    tools: [],
    skills: [],
    models: [],
    failures: [],
    events: [],
    runs: [],
  };
}

function formatIndexedAt(value: number | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
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
  const [insights, setInsights] = useState<TraceInsightsResponse>(emptyInsights);
  const [indexStatus, setIndexStatus] = useState<TraceIndexStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timedOut = false;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, METRICS_TIMEOUT_MS);
    setLoading(true);
    setError(null);
    fetchTraceInsights(requestFilters, controller.signal)
      .then((result) => {
        if (!cancelled) setInsights(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            timedOut
              ? "Timed out loading trace metrics. Try narrowing the filters or rebuilding the trace index."
              : String(err),
          );
        }
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [requestFilters]);

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
                  label="Indexed Sessions"
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
                detail={`${formatCount(summary.totalSessions)} sessions, ${formatCount(summary.totalRuns)} runs`}
              />
              <MetricCard
                label="Total Turns"
                value={formatCount(summary.totalTurns)}
                detail={`${summary.averageTurns.toFixed(1)} avg turns/session`}
              />
              <MetricCard
                label="Success Rate"
                value={formatPercent(summary.successRate)}
                detail={`${formatCount(summary.completedSessions)} completed, ${formatCount(summary.failedSessions)} failed`}
                tone={summary.failedSessions > 0 ? "warning" : "success"}
              />
              <MetricCard
                label="Tool Failure Rate"
                value={formatPercent(summary.toolFailureRate)}
                detail={`${formatCount(summary.toolFailures)} failed of ${formatCount(summary.toolCalls)} calls`}
                tone={summary.toolFailures > 0 ? "warning" : "success"}
              />
            </div>
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
              <div className="grid grid-cols-[minmax(180px,1.6fr)_70px_70px_80px_90px_90px_80px] gap-3 border-b border-trace-border px-3 py-2 text-[10px] uppercase tracking-wider text-trace-muted">
                <span>Model</span>
                <span>Sessions</span>
                <span>Runs</span>
                <span>Requests</span>
                <span>Est. Cost</span>
                <span>Output Share</span>
                <span>Fail Rate</span>
              </div>
              {insights.models.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-trace-muted">
                  No model metrics found for the current filters.
                </div>
              ) : (
                insights.models.slice(0, 12).map((row) => (
                  <div
                    key={row.id}
                    className="grid grid-cols-[minmax(180px,1.6fr)_70px_70px_80px_90px_90px_80px] gap-3 border-b border-trace-border/50 px-3 py-2 text-[12px] last:border-b-0"
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
                      {formatPercent(row.failureRate)}
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
