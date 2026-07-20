import React, { useState } from "react";
import type {
  HarnessRatchetCandidate,
  TraceInsightsMetricRow,
  TraceInsightsRunRow,
} from "../../api";
import {
  extractQueryTitle,
  formatCost,
  formatCount,
  formatDuration,
  formatPercent,
  outcomeClass,
  truncate,
} from "../../utils";
import Badge from "../Badge";

// Drill-down tables for the Analytics tab. Moved verbatim from the retired
// InsightsTab/MetricsTab so AnalyticsTab stays a thin composition layer.

export type MetricSection =
  | "failures"
  | "tools"
  | "skills"
  | "models"
  | "events";

export function rateConfidenceInterval(
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
    z * Math.sqrt((phat * (1 - phat) + z2 / (4 * total)) / total);
  return {
    low: Math.max(0, (center - margin) / denominator),
    high: Math.min(1, (center + margin) / denominator),
  };
}

export function formatRateRange(successes: number, total: number): string {
  const ci = rateConfidenceInterval(successes, total);
  return `${formatPercent(ci.low)}-${formatPercent(ci.high)}`;
}

export function formatIndexedAt(value: number | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

export function MetricTable({
  rows,
  section,
  onSelectSession,
  onFocusRun,
  onFilter,
}: {
  rows: TraceInsightsMetricRow[];
  section: MetricSection;
  onSelectSession: (sessionId: string) => void;
  onFocusRun: (runId: string) => void;
  onFilter: (value: string) => void;
}) {
  const activityLabel =
    section === "tools"
      ? "Calls"
      : section === "models"
        ? "Requests"
        : section === "events"
          ? "Events"
          : section === "failures"
            ? "Failures"
            : "Uses";

  if (rows.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-trace-muted">
        No {section} found for the current filters.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded border border-trace-border bg-trace-bg">
      <div className="grid grid-cols-[minmax(180px,1.7fr)_80px_80px_90px_90px_100px_minmax(120px,1fr)] gap-3 border-b border-trace-border px-3 py-2 text-[10px] uppercase tracking-wider text-trace-muted">
        <span>Name</span>
        <span>Traces</span>
        <span>Runs</span>
        <span>{activityLabel}</span>
        <span>Fail rate</span>
        <span>Avg time</span>
        <span>Sample</span>
      </div>
      {rows.map((row) => (
        <div
          key={row.id}
          className="grid grid-cols-[minmax(180px,1.7fr)_80px_80px_90px_90px_100px_minmax(120px,1fr)] gap-3 border-b border-trace-border/50 px-3 py-2 text-[12px] last:border-b-0"
        >
          <button
            type="button"
            onClick={() => onFilter(row.id)}
            className="min-w-0 text-left text-trace-text hover:text-trace-accent-light"
            title={`Filter by ${row.label}`}
          >
            <span className="truncate block">{row.label}</span>
            {row.sampleError && (
              <span className="mt-0.5 block truncate text-[10px] text-state-error">
                {truncate(row.sampleError, 90)}
              </span>
            )}
          </button>
          <span className="text-trace-subtle">{formatCount(row.sessions)}</span>
          <span className="text-trace-subtle">{formatCount(row.runs)}</span>
          <span className="text-trace-subtle">
            {formatCount(
              section === "models"
                ? row.requests ?? row.calls
                : section === "failures"
                  ? row.failures ?? row.calls
                  : row.calls,
            )}
          </span>
          <span className="text-trace-subtle">{formatPercent(row.failureRate)}</span>
          <span className="text-trace-subtle">
            {row.averageDurationMs ? formatDuration(row.averageDurationMs) : "-"}
          </span>
          <span className="flex min-w-0 gap-2">
            {row.sampleSessionId && (
              <button
                type="button"
                onClick={() => onSelectSession(row.sampleSessionId!)}
                className="font-mono text-[10px] text-trace-accent-light hover:underline"
              >
                {row.sampleSessionId.slice(0, 8)}
              </button>
            )}
            {row.sampleRunId && (
              <button
                type="button"
                onClick={() => onFocusRun(row.sampleRunId!)}
                className="font-mono text-[10px] text-brand-live hover:underline"
              >
                {row.sampleRunId.slice(0, 8)}
              </button>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function severityClass(severity: HarnessRatchetCandidate["severity"]): string {
  if (severity === "high") return "text-state-error";
  if (severity === "medium") return "text-state-warning";
  return "text-trace-muted";
}

export function RatchetTable({
  rows,
  onSelectSession,
  onFocusRun,
}: {
  rows: HarnessRatchetCandidate[];
  onSelectSession: (sessionId: string) => void;
  onFocusRun: (runId: string) => void;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-trace-muted">
        No ratchet candidates found in the current SQLite index.
      </div>
    );
  }

  const copyBrief = async (row: HarnessRatchetCandidate) => {
    const brief = [
      `Harness ratchet candidate: ${row.title}`,
      `Layer: ${row.harnessLayer}`,
      `Severity: ${row.severity}`,
      `Count: ${row.count}`,
      row.failureRate == null
        ? null
        : `Failure rate: ${formatPercent(row.failureRate)}`,
      row.sampleSessionId ? `Sample trace: ${row.sampleSessionId}` : null,
      row.sampleRunId ? `Sample run: ${row.sampleRunId}` : null,
      `Evidence query: ${row.evidenceQuery}`,
      `Suggested action: ${row.suggestedAction}`,
    ]
      .filter(Boolean)
      .join("\n");
    await navigator.clipboard?.writeText(brief);
    setCopiedId(row.id);
    window.setTimeout(() => setCopiedId(null), 1200);
  };

  return (
    <div className="overflow-hidden rounded border border-trace-border bg-trace-bg">
      <div className="grid grid-cols-[minmax(220px,1.7fr)_80px_90px_80px_minmax(160px,1fr)_minmax(130px,0.8fr)] gap-3 border-b border-trace-border px-3 py-2 text-[10px] uppercase tracking-wider text-trace-muted">
        <span>Candidate</span>
        <span>Layer</span>
        <span>Severity</span>
        <span>Count</span>
        <span>Evidence</span>
        <span>Action</span>
      </div>
      {rows.map((row) => (
        <div
          key={row.id}
          className="grid grid-cols-[minmax(220px,1.7fr)_80px_90px_80px_minmax(160px,1fr)_minmax(130px,0.8fr)] gap-3 border-b border-trace-border/50 px-3 py-2 text-[12px] last:border-b-0"
        >
          <div className="min-w-0">
            <div className="truncate text-trace-text">{row.title}</div>
            <div className="mt-0.5 truncate text-[10px] text-trace-muted">
              {row.suggestedAction}
            </div>
          </div>
          <span className="text-trace-subtle">{row.harnessLayer}</span>
          <span className={`font-semibold ${severityClass(row.severity)}`}>
            {row.severity}
          </span>
          <span className="text-trace-subtle">
            {formatCount(row.count)}
            {row.failureRate == null
              ? ""
              : ` / ${formatPercent(row.failureRate)}`}
          </span>
          <span className="flex min-w-0 gap-2">
            {row.sampleSessionId && (
              <button
                type="button"
                onClick={() => onSelectSession(row.sampleSessionId!)}
                className="font-mono text-[10px] text-trace-accent-light hover:underline"
              >
                {row.sampleSessionId.slice(0, 8)}
              </button>
            )}
            {row.sampleRunId && (
              <button
                type="button"
                onClick={() => onFocusRun(row.sampleRunId!)}
                className="font-mono text-[10px] text-brand-live hover:underline"
              >
                {row.sampleRunId.slice(0, 8)}
              </button>
            )}
          </span>
          <button
            type="button"
            onClick={() => void copyBrief(row)}
            className="text-left text-[11px] text-trace-accent-light hover:underline"
          >
            {copiedId === row.id ? "Copied" : "Copy brief"}
          </button>
        </div>
      ))}
    </div>
  );
}

export function RunsInsightTable({
  rows,
  onSelectSession,
  onFocusRun,
}: {
  rows: TraceInsightsRunRow[];
  onSelectSession: (sessionId: string) => void;
  onFocusRun: (runId: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-trace-muted">
        No runs found for the current filters.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded border border-trace-border bg-trace-bg">
      <div className="grid grid-cols-[90px_minmax(220px,1.8fr)_90px_90px_90px_90px_minmax(120px,1fr)_minmax(120px,1fr)] gap-3 border-b border-trace-border px-3 py-2 text-[10px] uppercase tracking-wider text-trace-muted">
        <span>Run</span>
        <span>Query</span>
        <span>Outcome</span>
        <span>Traces</span>
        <span>Turns</span>
        <span>Cost</span>
        <span>Tools</span>
        <span>Skills</span>
      </div>
      {rows.map((row) => (
        <div
          key={row.runId}
          className="grid grid-cols-[90px_minmax(220px,1.8fr)_90px_90px_90px_90px_minmax(120px,1fr)_minmax(120px,1fr)] gap-3 border-b border-trace-border/50 px-3 py-2 text-[12px] last:border-b-0"
        >
          <button
            type="button"
            onClick={() => onFocusRun(row.runId)}
            className="font-mono text-[10px] text-trace-accent-light hover:underline"
          >
            {row.runId.slice(0, 8)}
          </button>
          <button
            type="button"
            onClick={() => onSelectSession(row.sampleSessionId)}
            className="min-w-0 text-left text-trace-text hover:text-trace-accent-light"
          >
            {truncate(extractQueryTitle(row.query).title, 80)}
          </button>
          <Badge
            variant={
              outcomeClass(row.outcome) as
                | "completed"
                | "stopped"
                | "error"
                | "max_turns"
            }
          >
            {row.outcome}
          </Badge>
          <span className="text-trace-subtle">
            {formatCount(row.sessions)}
            {row.failedSessions > 0
              ? ` (${formatCount(row.failedSessions)} failed)`
              : ""}
          </span>
          <span className="text-trace-subtle">{formatCount(row.totalTurns)}</span>
          <span className="text-trace-subtle">
            {formatCost(row.totalCost) || "$0"}
          </span>
          <span className="truncate text-trace-subtle">
            {row.topTools.length > 0 ? row.topTools.join(", ") : "-"}
          </span>
          <span className="truncate text-trace-subtle">
            {row.topSkills.length > 0 ? row.topSkills.join(", ") : "-"}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ModelMixTable({
  rows,
}: {
  rows: TraceInsightsMetricRow[];
}) {
  return (
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
      {rows.length === 0 ? (
        <div className="px-3 py-8 text-center text-sm text-trace-muted">
          No model metrics found for the current filters.
        </div>
      ) : (
        rows.slice(0, 12).map((row) => (
          <div
            key={row.id}
            className="grid grid-cols-[minmax(180px,1.6fr)_70px_70px_80px_90px_90px_110px] gap-3 border-b border-trace-border/50 px-3 py-2 text-[12px] last:border-b-0"
          >
            <span className="min-w-0 truncate text-trace-text">{row.label}</span>
            <span className="text-trace-subtle">{formatCount(row.sessions)}</span>
            <span className="text-trace-subtle">{formatCount(row.runs)}</span>
            <span className="text-trace-subtle">
              {formatCount(row.requests ?? row.calls)}
            </span>
            <span className="text-trace-subtle">
              {formatCost(
                row.estimatedRequestCost ?? row.requestCost ?? row.totalCost,
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
  );
}
