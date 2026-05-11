import React, { useEffect, useMemo, useState } from "react";
import {
  fetchTraceIndexStatus,
  fetchTraceInsights,
  type TraceIndexStatus,
  type TraceInsightsQuery,
  type TraceInsightsResponse,
} from "../../api";
import { useStore } from "../../store";
import { formatCost, formatDuration, formatTokens } from "../../utils";
import LoadingSpinner from "../LoadingSpinner";

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
      totalTokens: 0,
      requestCost: 0,
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

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function numberValue(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString("en-US") : "0";
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
    setLoading(true);
    setError(null);
    fetchTraceInsights(requestFilters)
      .then((result) => {
        if (!cancelled) setInsights(result);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
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
                  value={numberValue(indexStatus.sessions)}
                  detail={`${numberValue(indexStatus.hotSessions)} hot, ${numberValue(indexStatus.archivedSessions)} archived`}
                  tone={indexStatus.available ? "success" : "warning"}
                />
                <MetricCard
                  label="Indexed Turns"
                  value={numberValue(indexStatus.turns)}
                  detail={`${numberValue(indexStatus.tools)} tool calls`}
                />
                <MetricCard
                  label="Artifacts"
                  value={numberValue(indexStatus.screenshots)}
                  detail={`${numberValue(indexStatus.runEvents)} run events`}
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
                value={numberValue(summary.llmRequests)}
                detail={`${numberValue(summary.totalSessions)} sessions, ${numberValue(summary.totalRuns)} runs`}
              />
              <MetricCard
                label="Total Turns"
                value={numberValue(summary.totalTurns)}
                detail={`${summary.averageTurns.toFixed(1)} avg turns/session`}
              />
              <MetricCard
                label="Success Rate"
                value={pct(summary.successRate)}
                detail={`${numberValue(summary.completedSessions)} completed, ${numberValue(summary.failedSessions)} failed`}
                tone={summary.failedSessions > 0 ? "warning" : "success"}
              />
              <MetricCard
                label="Tool Failure Rate"
                value={pct(summary.toolFailureRate)}
                detail={`${numberValue(summary.toolFailures)} failed of ${numberValue(summary.toolCalls)} calls`}
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
                detail={`${formatTokens(Math.round(summary.averagePromptTokens))} avg/request`}
              />
              <MetricCard
                label="Output Tokens"
                value={formatTokens(summary.completionTokens)}
                detail={`${formatTokens(Math.round(summary.averageCompletionTokens))} avg/request`}
              />
              <MetricCard
                label="Total Tokens"
                value={formatTokens(summary.totalTokens)}
                detail={`${formatTokens(Math.round(summary.averageTotalTokens))} avg/request`}
              />
              <MetricCard
                label="Request Cost"
                value={formatCost(requestCost) || "$0"}
                detail="Summed from request usage when available"
              />
              <MetricCard
                label="Avg LLM Latency"
                value={formatDuration(summary.averageLlmDurationMs)}
                detail={`${formatDuration(summary.totalLlmDurationMs)} total`}
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
              <div className="grid grid-cols-[minmax(180px,1.6fr)_80px_80px_90px_90px] gap-3 border-b border-trace-border px-3 py-2 text-[10px] uppercase tracking-wider text-trace-muted">
                <span>Model</span>
                <span>Sessions</span>
                <span>Runs</span>
                <span>Calls</span>
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
                    className="grid grid-cols-[minmax(180px,1.6fr)_80px_80px_90px_90px] gap-3 border-b border-trace-border/50 px-3 py-2 text-[12px] last:border-b-0"
                  >
                    <span className="min-w-0 truncate text-trace-text">
                      {row.label}
                    </span>
                    <span className="text-trace-subtle">{row.sessions}</span>
                    <span className="text-trace-subtle">{row.runs}</span>
                    <span className="text-trace-subtle">{row.calls ?? "-"}</span>
                    <span className="text-trace-subtle">
                      {row.failureRate == null ? "-" : pct(row.failureRate)}
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
