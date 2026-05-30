import React, { useEffect, useMemo, useState } from "react";
import {
  fetchHarnessRatchet,
  type HarnessRatchetCandidate,
  type TraceInsightsMetricRow,
  type TraceInsightsQuery,
  type TraceInsightsRunRow,
} from "../../api";
import { useInsightsData } from "../../hooks/useInsightsData";
import { useDebounce } from "../../hooks/useDebounce";
import { useStore } from "../../store";
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
import LoadingSpinner from "../LoadingSpinner";

type InsightSection =
  | "ratchet"
  | "failures"
  | "tools"
  | "skills"
  | "runs"
  | "models"
  | "events";

interface InsightsTabProps {
  onSelectSession: (sessionId: string) => void;
  onFocusRun: (runId: string) => void;
}

const SECTIONS: Array<{ id: InsightSection; label: string }> = [
  { id: "ratchet", label: "Ratchet" },
  { id: "failures", label: "Failures" },
  { id: "tools", label: "Tools" },
  { id: "skills", label: "Skills" },
  { id: "runs", label: "Runs" },
  { id: "models", label: "Models" },
  { id: "events", label: "Events" },
];


export default function InsightsTab({
  onSelectSession,
  onFocusRun,
}: InsightsTabProps) {
  const filters = useStore((s) => s.filters);
  const setFilter = useStore((s) => s.setFilter);
  const [section, setSection] = useState<InsightSection>("failures");
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

  const requestFilters = useMemo<TraceInsightsQuery>(
    () => ({
      outcome: filters.outcome,
      day: filters.day,
      from: filters.from,
      to: filters.to,
      domain: filters.domain,
      model: filters.model,
      runId: filters.runId,
      skill,
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
      filters.to,
      debouncedQuery,
      skill,
      tool,
      toolStatus,
    ],
  );

  const { insights, loading, error } = useInsightsData(requestFilters);

  useEffect(() => {
    let cancelled = false;
    fetchHarnessRatchet()
      .then((result) => {
        if (!cancelled) setRatchet(result);
      })
      .catch(() => {
        if (!cancelled) setRatchet([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyRun = (runId: string) => {
    setFilter("runId", runId);
    onFocusRun(runId);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="grid grid-cols-2 xl:grid-cols-6 gap-2 px-5 py-3 border-b border-trace-border bg-trace-panel/70 shrink-0">
        <KpiCard label="Traces" value={formatCount(insights.summary.totalSessions)} />
        <KpiCard label="Runs" value={formatCount(insights.summary.totalRuns)} />
        <KpiCard label="Success" value={formatPercent(insights.summary.successRate)} />
        <KpiCard label="Tool fails" value={formatPercent(insights.summary.toolFailureRate)} />
        <KpiCard label="Turns" value={formatCount(insights.summary.totalTurns)} />
        <KpiCard label="Cost" value={formatCost(insights.summary.totalCost) || "$0"} />
      </div>

      <div className="px-5 py-3 border-b border-trace-border bg-trace-bg shrink-0">
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
      </div>

      <div className="flex items-center gap-2 px-5 py-2 border-b border-trace-border bg-trace-panel/50 shrink-0">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSection(item.id)}
            className={`px-3 py-1.5 text-[11px] font-semibold rounded border transition-colors ${
              section === item.id
                ? "border-trace-accent/40 bg-trace-accent/15 text-trace-accent-light"
                : "border-trace-border text-trace-muted hover:text-trace-text"
            }`}
          >
            {item.label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-trace-muted">
          Avg {insights.summary.averageTurns.toFixed(1)} turns -{" "}
          {formatDuration(insights.summary.averageDurationMs)} avg duration
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-5 py-4">
        {loading ? (
          <LoadingSpinner message="Loading insights..." />
        ) : error ? (
          <div className="rounded border border-state-error/25 bg-state-error/10 px-3 py-2 text-sm text-state-error">
            Failed to load insights: {error}
          </div>
        ) : section === "ratchet" ? (
          <RatchetTable
            rows={ratchet}
            onSelectSession={onSelectSession}
            onFocusRun={applyRun}
          />
        ) : section === "runs" ? (
          <RunsInsightTable
            rows={insights.runs}
            onSelectSession={onSelectSession}
            onFocusRun={applyRun}
          />
        ) : (
          <MetricTable
            rows={insights[section]}
            section={section}
            onSelectSession={onSelectSession}
            onFocusRun={applyRun}
            onFilter={(value) => {
              if (section === "tools") setTool(value);
              if (section === "skills") setSkill(value);
              if (section === "failures") setFailure(value);
              if (section === "events") setEventType(value);
            }}
          />
        )}
      </div>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded border border-trace-border bg-trace-bg px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-trace-muted">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-trace-text">{value}</div>
    </div>
  );
}

function SelectFilter({
  label,
  value,
  onChange,
  options,
  emptyLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  emptyLabel: string;
}) {
  return (
    <label className="min-w-0">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full px-2 py-1.5 text-sm bg-trace-surface border border-trace-border rounded text-trace-text focus:outline-none focus:border-trace-accent"
      >
        <option value={value === "" ? "" : "all"}>{emptyLabel}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function MetricTable({
  rows,
  section,
  onSelectSession,
  onFocusRun,
  onFilter,
}: {
  rows: TraceInsightsMetricRow[];
  section: InsightSection;
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

function RatchetTable({
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

function RunsInsightTable({
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
