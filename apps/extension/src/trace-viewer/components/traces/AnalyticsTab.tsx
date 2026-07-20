import React, { useEffect, useMemo, useState } from "react";
import {
  fetchHarnessRatchet,
  fetchTraceIndexStatus,
  type HarnessRatchetCandidate,
  type TraceIndexStatus,
  type TraceInsightsQuery,
} from "../../api";
import { useInsightsData } from "../../hooks/useInsightsData";
import { useTrendData } from "../../hooks/useTrendData";
import { useDebounce } from "../../hooks/useDebounce";
import { useStore } from "../../store";
import {
  formatCost,
  formatCount,
  formatDuration,
  formatPercent,
  formatTokens,
} from "../../utils";
import StatTile from "../StatTile";
import CollapsibleSection from "../CollapsibleSection";
import LoadingSpinner from "../LoadingSpinner";
import TrendChart from "./TrendChart";
import SelectFilter from "./SelectFilter";
import {
  downloadBlob,
  insightsExportFilename,
  serializeInsightsCsv,
} from "../../analysis/insights-export";
import {
  formatIndexedAt,
  formatRateRange,
  MetricTable,
  ModelMixTable,
  RatchetTable,
  RunsInsightTable,
} from "./analytics-sections";

interface AnalyticsTabProps {
  onSelectSession: (sessionId: string) => void;
  onFocusRun: (runId: string) => void;
}

// The single analytics surface: one KPI row + trend chart up top, everything
// deeper behind collapsed sections. Merges the retired Insights and Metrics
// tabs; all aggregates come from the same server-side /api/trace-insights
// response, so this component only renders (and, later, exports) them.
export default function AnalyticsTab({
  onSelectSession,
  onFocusRun,
}: AnalyticsTabProps) {
  const filters = useStore((s) => s.filters);
  const setFilter = useStore((s) => s.setFilter);
  const [tool, setTool] = useState("");
  const [toolStatus, setToolStatus] = useState("all");
  const [skill, setSkill] = useState("all");
  const [failure, setFailure] = useState("all");
  const [eventType, setEventType] = useState("all");
  const [query, setQuery] = useState("");
  // Debounce the free-text query so each keystroke does not refetch insights;
  // the input stays controlled by `query` for instant feedback.
  const debouncedQuery = useDebounce(query, 250);
  const [ratchet, setRatchet] = useState<HarnessRatchetCandidate[]>([]);
  const [indexStatus, setIndexStatus] = useState<TraceIndexStatus | null>(null);

  const requestFilters = useMemo<TraceInsightsQuery>(
    () => ({
      outcome: filters.outcome,
      day: filters.day,
      from: filters.from,
      to: filters.to,
      domain: filters.domain,
      model: filters.model,
      runId: filters.runId,
      // The local facet wins when set; otherwise the FilterBar skill applies.
      skill: skill !== "all" ? skill : filters.skill,
      tool,
      toolStatus,
      failure,
      eventType,
      q: debouncedQuery,
    }),
    [
      eventType,
      failure,
      filters.day,
      filters.domain,
      filters.from,
      filters.model,
      filters.outcome,
      filters.runId,
      filters.skill,
      filters.to,
      debouncedQuery,
      skill,
      tool,
      toolStatus,
    ],
  );

  const { insights, loading, error } = useInsightsData(requestFilters);
  const { points: trendPoints, loading: trendLoading } =
    useTrendData(requestFilters);

  useEffect(() => {
    let cancelled = false;
    fetchHarnessRatchet()
      .then((result) => {
        if (!cancelled) setRatchet(result);
      })
      .catch(() => {
        if (!cancelled) setRatchet([]);
      });
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

  const applyRun = (runId: string) => {
    setFilter("runId", runId);
    onFocusRun(runId);
  };

  const summary = insights.summary;
  const requestCost = summary.requestCost || summary.totalCost;
  const estimatedRequestCost = summary.estimatedRequestCost || requestCost;
  const costSourceDetail =
    summary.unpricedRequests > 0
      ? `${formatCount(summary.unpricedRequests)} unpriced requests`
      : "Estimated from local pricing";

  if (loading) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-5 py-4">
        <LoadingSpinner message="Loading analytics..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-5 py-4">
        <div className="rounded border border-state-error/25 bg-state-error/10 px-3 py-2 text-sm text-state-error">
          Failed to load analytics: {error}
        </div>
      </div>
    );
  }

  // Serialize exactly the insights object being rendered, so the file always
  // matches the on-screen filtered aggregates.
  const exportInsights = (format: "csv" | "json") => {
    const name = insightsExportFilename(requestFilters, format);
    if (format === "csv") {
      downloadBlob(name, "text/csv", serializeInsightsCsv(insights));
    } else {
      downloadBlob(
        name,
        "application/json",
        JSON.stringify(insights, null, 2),
      );
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-5 py-4">
      <div className="space-y-4">
        {/* Export the current filtered aggregates */}
        <div className="flex items-center justify-end gap-1">
          <span className="mr-1 text-[10px] uppercase tracking-[0.18em] text-trace-muted">
            ⇣ Export
          </span>
          <button
            type="button"
            onClick={() => exportInsights("csv")}
            className="rounded border border-trace-border px-2 py-1 text-[11px] font-semibold text-trace-subtle hover:border-trace-accent/50 hover:text-trace-text transition-colors"
          >
            CSV
          </button>
          <button
            type="button"
            onClick={() => exportInsights("json")}
            className="rounded border border-trace-border px-2 py-1 text-[11px] font-semibold text-trace-subtle hover:border-trace-accent/50 hover:text-trace-text transition-colors"
          >
            JSON
          </button>
        </div>
        {/* KPI row */}
        <div className="grid grid-cols-2 xl:grid-cols-6 gap-2">
          <StatTile
            label="Traces"
            value={formatCount(summary.totalSessions)}
          />
          <StatTile label="Runs" value={formatCount(summary.totalRuns)} />
          <StatTile
            label="Success"
            value={formatPercent(summary.successRate)}
            sub={`n=${formatCount(summary.totalSessions)}, ${formatRateRange(summary.completedSessions, summary.totalSessions)}`}
            tone={summary.failedSessions > 0 ? "warning" : "success"}
          />
          <StatTile
            label="Tool fails"
            value={formatPercent(summary.toolFailureRate)}
            sub={`n=${formatCount(summary.toolCalls)}, ${formatRateRange(summary.toolFailures, summary.toolCalls)}`}
            tone={summary.toolFailures > 0 ? "warning" : "success"}
          />
          <StatTile
            label="Turns"
            value={formatCount(summary.totalTurns)}
            sub={`${summary.averageTurns.toFixed(1)} avg, ${formatDuration(summary.averageDurationMs)} avg duration`}
          />
          <StatTile
            label="Est. cost"
            value={formatCost(estimatedRequestCost) || "$0"}
            sub={costSourceDetail}
            tone={summary.unpricedRequests > 0 ? "warning" : "neutral"}
          />
        </div>

        {/* Trend */}
        {trendLoading && trendPoints.length === 0 ? (
          <LoadingSpinner message="Loading trends..." />
        ) : (
          <TrendChart points={trendPoints} />
        )}

        {/* Facets */}
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-7 gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search query, URL, trace..."
            className="md:col-span-2 xl:col-span-2 px-3 py-1.5 text-sm bg-trace-surface border border-trace-border rounded text-trace-text placeholder:text-trace-dim focus:outline-none focus:border-trace-accent"
          />
          <SelectFilter
            label="Tool"
            value={tool}
            onChange={setTool}
            options={insights.facets.tools}
            emptyLabel="All tools"
            emptyValue=""
          />
          <SelectFilter
            label="Tool status"
            value={toolStatus}
            onChange={setToolStatus}
            options={["success", "failure"]}
            emptyLabel="All statuses"
          />
          <SelectFilter
            label="Skill"
            value={skill}
            onChange={setSkill}
            options={insights.facets.skills}
            emptyLabel="All skills"
          />
          <SelectFilter
            label="Failure"
            value={failure}
            onChange={setFailure}
            options={insights.facets.failures}
            emptyLabel="All failures"
          />
          <SelectFilter
            label="Event"
            value={eventType}
            onChange={setEventType}
            options={insights.facets.eventTypes}
            emptyLabel="All events"
          />
        </div>

        {/* Drill-downs, collapsed by default */}
        <div className="space-y-2">
          <CollapsibleSection
            label="Escalations"
            preview={
              summary.escalations === 0
                ? "none"
                : `${formatPercent(summary.escalationFireRate)} fire · ${formatPercent(summary.escalationRescueRate)} rescue`
            }
          >
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 pt-2">
              <StatTile
                label="Fire rate"
                value={formatPercent(summary.escalationFireRate)}
                sub={`${formatCount(summary.escalatedSessions)} of ${formatCount(summary.totalSessions)} traces, ${formatCount(summary.escalations)} fires`}
                tone={summary.escalations > 0 ? "warning" : "success"}
              />
              <StatTile
                label="Rescue rate"
                value={formatPercent(summary.escalationRescueRate)}
                sub={`${formatCount(summary.escalationRescued)} rescued after escalating`}
                tone={
                  summary.escalations === 0
                    ? "neutral"
                    : summary.escalationRescueRate >= 0.5
                      ? "success"
                      : "warning"
                }
              />
              <StatTile
                label="Failed fast"
                value={formatCount(summary.escalationFailedFast)}
                tone={summary.escalationFailedFast > 0 ? "warning" : "neutral"}
              />
              <StatTile
                label="Budget exhausted"
                value={formatCount(summary.escalationBudgetExhausted)}
                tone={
                  summary.escalationBudgetExhausted > 0 ? "warning" : "neutral"
                }
              />
            </div>
          </CollapsibleSection>
          <CollapsibleSection
            label="Failures"
            preview={`${formatCount(insights.failures.length)} kinds`}
          >
            <div className="pt-2">
              <MetricTable
                rows={insights.failures}
                section="failures"
                onSelectSession={onSelectSession}
                onFocusRun={applyRun}
                onFilter={setFailure}
              />
            </div>
          </CollapsibleSection>
          <CollapsibleSection
            label="Tools"
            preview={`${formatCount(insights.tools.length)} tools`}
          >
            <div className="pt-2">
              <MetricTable
                rows={insights.tools}
                section="tools"
                onSelectSession={onSelectSession}
                onFocusRun={applyRun}
                onFilter={setTool}
              />
            </div>
          </CollapsibleSection>
          <CollapsibleSection
            label="Skills"
            preview={`${formatCount(insights.skills.length)} skills`}
          >
            <div className="pt-2">
              <MetricTable
                rows={insights.skills}
                section="skills"
                onSelectSession={onSelectSession}
                onFocusRun={applyRun}
                onFilter={setSkill}
              />
            </div>
          </CollapsibleSection>
          <CollapsibleSection
            label="Runs"
            preview={`${formatCount(insights.runs.length)} runs`}
          >
            <div className="pt-2">
              <RunsInsightTable
                rows={insights.runs}
                onSelectSession={onSelectSession}
                onFocusRun={applyRun}
              />
            </div>
          </CollapsibleSection>
          <CollapsibleSection
            label="Models"
            preview={`${formatCount(insights.models.length)} models`}
          >
            <div className="pt-2">
              <ModelMixTable rows={insights.models} />
            </div>
          </CollapsibleSection>
          <CollapsibleSection
            label="Events"
            preview={`${formatCount(insights.events.length)} types`}
          >
            <div className="pt-2">
              <MetricTable
                rows={insights.events}
                section="events"
                onSelectSession={onSelectSession}
                onFocusRun={applyRun}
                onFilter={setEventType}
              />
            </div>
          </CollapsibleSection>
          <CollapsibleSection
            label="Ratchet"
            preview={`${formatCount(ratchet.length)} candidates`}
          >
            <div className="pt-2">
              <RatchetTable
                rows={ratchet}
                onSelectSession={onSelectSession}
                onFocusRun={applyRun}
              />
            </div>
          </CollapsibleSection>
          <CollapsibleSection label="Tokens & cost detail">
            <div className="space-y-2 pt-2">
              <div className="grid grid-cols-2 xl:grid-cols-5 gap-2">
                <StatTile
                  label="Input tokens"
                  value={formatTokens(summary.promptTokens)}
                  sub={`${formatTokens(summary.nonCachedInputTokens)} non-cached, ${formatTokens(summary.cachedTokens)} cached`}
                />
                <StatTile
                  label="Output tokens"
                  value={formatTokens(summary.completionTokens)}
                  sub={`${formatPercent(summary.outputTokenShare)} of tokens`}
                />
                <StatTile
                  label="Total tokens"
                  value={formatTokens(summary.totalTokens)}
                  sub={`${formatTokens(Math.round(summary.averageTotalTokens))} avg/request`}
                />
                <StatTile
                  label="LLM requests"
                  value={formatCount(summary.llmRequests)}
                  sub={`${formatDuration(summary.averageLlmDurationMs)} avg latency`}
                />
                <StatTile
                  label="LLM time"
                  value={formatDuration(summary.totalLlmDurationMs)}
                  sub="Total LLM wall clock"
                />
              </div>
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
                <StatTile
                  label="Input cost"
                  value={formatCost(summary.estimatedInputCost) || "$0"}
                  sub={`${formatTokens(summary.nonCachedInputTokens)} non-cached input`}
                />
                <StatTile
                  label="Cached input cost"
                  value={formatCost(summary.estimatedCachedInputCost) || "$0"}
                  sub={`${formatTokens(summary.cachedTokens)} cached input`}
                />
                <StatTile
                  label="Output cost"
                  value={formatCost(summary.estimatedOutputCost) || "$0"}
                  sub={`${formatTokens(summary.completionTokens)} output tokens`}
                />
                <StatTile
                  label="Output cost share"
                  value={formatPercent(summary.outputCostShare)}
                  sub="Share of estimated request cost"
                />
              </div>
            </div>
          </CollapsibleSection>
          {indexStatus && (
            <CollapsibleSection
              label="Trace index"
              preview={`${formatCount(indexStatus.sessions)} indexed via ${indexStatus.source}`}
            >
              <div className="grid grid-cols-2 xl:grid-cols-5 gap-2 pt-2">
                <StatTile
                  label="Indexed traces"
                  value={formatCount(indexStatus.sessions)}
                  sub={`${formatCount(indexStatus.hotSessions)} hot, ${formatCount(indexStatus.archivedSessions)} archived`}
                  tone={indexStatus.available ? "success" : "warning"}
                />
                <StatTile
                  label="Indexed turns"
                  value={formatCount(indexStatus.turns)}
                  sub={`${formatCount(indexStatus.tools)} tool calls`}
                />
                <StatTile
                  label="Artifacts"
                  value={formatCount(indexStatus.screenshots)}
                  sub={`${formatCount(indexStatus.runEvents)} run events`}
                />
                <StatTile
                  label="Trace range"
                  value={indexStatus.newestSessionDay ?? "-"}
                  sub={indexStatus.oldestSessionDay ?? "No indexed dates"}
                />
                <StatTile
                  label="Last indexed"
                  value={formatIndexedAt(indexStatus.indexedAt)}
                  sub={`${indexStatus.hotTraceDays} day hot policy`}
                />
              </div>
            </CollapsibleSection>
          )}
        </div>
      </div>
    </div>
  );
}
