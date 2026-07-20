import type {
  TraceInsightsMetricRow,
  TraceInsightsQuery,
  TraceInsightsResponse,
  TraceInsightsRunRow,
} from "../api";

// Serializers for the Analytics export button. Pure functions over the
// already-fetched /api/trace-insights response, so exports always match the
// on-screen filtered aggregates and need no server round trip.

/** RFC-4180 field quoting: quote when the value contains , " or a newline. */
function csvField(value: unknown): string {
  if (value == null) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function csvLine(values: unknown[]): string {
  return values.map(csvField).join(",");
}

const METRIC_ROW_COLUMNS: Array<{
  header: string;
  pick: (row: TraceInsightsMetricRow) => unknown;
}> = [
  { header: "name", pick: (row) => row.label },
  { header: "sessions", pick: (row) => row.sessions },
  { header: "runs", pick: (row) => row.runs },
  { header: "calls", pick: (row) => row.calls ?? row.requests ?? "" },
  { header: "failures", pick: (row) => row.failures ?? "" },
  { header: "failure_rate", pick: (row) => row.failureRate ?? "" },
  { header: "avg_duration_ms", pick: (row) => row.averageDurationMs ?? "" },
  {
    header: "estimated_cost_usd",
    pick: (row) =>
      row.estimatedRequestCost ?? row.requestCost ?? row.totalCost ?? "",
  },
  { header: "sample_session", pick: (row) => row.sampleSessionId ?? "" },
  { header: "sample_run", pick: (row) => row.sampleRunId ?? "" },
];

const RUN_ROW_COLUMNS: Array<{
  header: string;
  pick: (row: TraceInsightsRunRow) => unknown;
}> = [
  { header: "run_id", pick: (row) => row.runId },
  { header: "query", pick: (row) => row.query },
  { header: "outcome", pick: (row) => row.outcome },
  { header: "sessions", pick: (row) => row.sessions },
  { header: "failed_sessions", pick: (row) => row.failedSessions },
  { header: "total_turns", pick: (row) => row.totalTurns },
  { header: "total_cost_usd", pick: (row) => row.totalCost },
  { header: "duration_ms", pick: (row) => row.durationMs },
  { header: "top_tools", pick: (row) => row.topTools.join("; ") },
  { header: "top_skills", pick: (row) => row.topSkills.join("; ") },
];

/**
 * One CSV document: a `summary` key/value section followed by one table per
 * drill-down (tools, skills, models, failures, events, runs). Sections are
 * separated by a blank line and introduced by a `# <section>` comment row so
 * the file stays a single spreadsheet-importable artifact.
 */
export function serializeInsightsCsv(insights: TraceInsightsResponse): string {
  const lines: string[] = [];

  lines.push("# summary");
  lines.push(csvLine(["metric", "value"]));
  for (const [key, value] of Object.entries(insights.summary)) {
    lines.push(csvLine([key, value]));
  }

  const metricSections: Array<[string, TraceInsightsMetricRow[]]> = [
    ["tools", insights.tools],
    ["skills", insights.skills],
    ["models", insights.models],
    ["failures", insights.failures],
    ["events", insights.events],
  ];
  for (const [name, rows] of metricSections) {
    lines.push("");
    lines.push(`# ${name}`);
    lines.push(csvLine(METRIC_ROW_COLUMNS.map((column) => column.header)));
    for (const row of rows) {
      lines.push(csvLine(METRIC_ROW_COLUMNS.map((column) => column.pick(row))));
    }
  }

  lines.push("");
  lines.push("# runs");
  lines.push(csvLine(RUN_ROW_COLUMNS.map((column) => column.header)));
  for (const row of insights.runs) {
    lines.push(csvLine(RUN_ROW_COLUMNS.map((column) => column.pick(row))));
  }

  return lines.join("\r\n") + "\r\n";
}

/** trace-insights-<window>.<ext>, derived from the active date filters. */
export function insightsExportFilename(
  filters: Pick<TraceInsightsQuery, "day" | "from" | "to">,
  ext: "csv" | "json",
): string {
  const window =
    filters.day && filters.day !== "all"
      ? filters.day
      : filters.from || filters.to
        ? `${filters.from || "start"}_${filters.to || "now"}`
        : "all";
  return `trace-insights-${window}.${ext}`;
}

/** Trigger a browser download of `text` as a file named `name`. */
export function downloadBlob(name: string, mime: string, text: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
