import React, { useMemo } from "react";
import type { TraceSession } from "../../../types/traces";
import { validateTraceBundle } from "../../analysis";
import type { TraceValidationIssue } from "../../analysis";
import { useStore } from "../../store";

interface TraceIntegrityPanelProps {
  session: TraceSession;
}

function issueClass(issue: TraceValidationIssue): string {
  return issue.severity === "error"
    ? "border-state-error/25 bg-state-error/5 text-state-error"
    : "border-state-warning/30 bg-state-warning/5 text-state-warning";
}

function IntegrityStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
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
    <div className="rounded border border-trace-border/70 bg-trace-bg px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wide text-trace-muted">
        {label}
      </div>
      <div className={`mt-1 text-sm font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

export default function TraceIntegrityPanel({
  session,
}: TraceIntegrityPanelProps) {
  const entries = useStore((s) => s.currentEntries);
  const runEvents = useStore((s) => s.currentRunEvents);

  const issues = useMemo(
    () =>
      validateTraceBundle({
        sessions: [session],
        entriesBySession: new Map([[session.sessionId, entries]]),
        runEventsByRun:
          session.runId && runEvents.length > 0
            ? new Map([[session.runId, runEvents]])
            : undefined,
      }),
    [entries, runEvents, session],
  );

  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const stableTurns = entries.filter((entry) => Boolean(entry.turnId)).length;
  const continuityIssues = issues.filter((issue) =>
    ["duplicate_turn", "missing_turn_gap", "out_of_order_turn"].includes(
      issue.code,
    ),
  );
  const eventCount = entries.reduce(
    (count, entry) => count + (entry.events?.length ?? 0),
    0,
  );
  const toolExecutionCount = entries.reduce(
    (count, entry) => count + (entry.toolExecutions?.length ?? 0),
    0,
  );
  const topIssues = issues.slice(0, 5);

  return (
    <section className="bg-trace-panel border border-trace-border rounded-lg p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] text-trace-muted uppercase tracking-wide mb-1">
            Trace Integrity
          </div>
          <div className="text-sm text-trace-text font-semibold">
            {errors.length === 0
              ? "Trace bundle is usable"
              : "Trace bundle has blocking integrity issues"}
          </div>
          <div className="mt-1 text-[12px] text-trace-muted leading-relaxed">
            Checks record shape, turn continuity, cross-stream links, and
            whether newer correlation IDs are present.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
        <IntegrityStat
          label="Errors"
          value={errors.length}
          tone={errors.length > 0 ? "error" : "success"}
        />
        <IntegrityStat
          label="Warnings"
          value={warnings.length}
          tone={warnings.length > 0 ? "warning" : "success"}
        />
        <IntegrityStat
          label="Turn IDs"
          value={`${stableTurns}/${entries.length}`}
          tone={stableTurns === entries.length ? "success" : "warning"}
        />
        <IntegrityStat
          label="Continuity"
          value={continuityIssues.length === 0 ? "ok" : continuityIssues.length}
          tone={continuityIssues.length === 0 ? "success" : "warning"}
        />
      </div>

      <div className="mt-2 text-[11px] text-trace-muted">
        Signals indexed: {eventCount + toolExecutionCount}
      </div>

      {topIssues.length > 0 && (
        <div className="mt-3 space-y-2">
          {topIssues.map((issue, index) => (
            <div
              key={`${issue.code}-${issue.turnNumber ?? "session"}-${index}`}
              className={`rounded border px-3 py-2 ${issueClass(issue)}`}
            >
              <div className="text-[12px] font-medium">{issue.code}</div>
              <div className="mt-1 text-[11px] text-trace-muted">
                {issue.message}
                {issue.turnNumber != null ? ` (turn ${issue.turnNumber})` : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
