import React, { useMemo, useState } from "react";
import type { TraceSession } from "../../../types/traces";
import {
  analyzeTraceSession,
  buildTraceInvestigationReport,
} from "../../analysis";
import type { InvestigationFinding } from "../../analysis";
import { useStore } from "../../store";
import { formatCost, formatTokens } from "../../utils";
import Badge from "../Badge";

interface InvestigationSummaryProps {
  session: TraceSession;
}

const SEVERITY_CLASS: Record<InvestigationFinding["severity"], string> = {
  error: "border-state-error/25 bg-state-error/5",
  warning: "border-state-warning/30 bg-state-warning/5",
  info: "border-trace-border bg-trace-bg",
};

const SEVERITY_DOT: Record<InvestigationFinding["severity"], string> = {
  error: "bg-state-error",
  warning: "bg-state-warning",
  info: "bg-trace-accent",
};

function formatClass(value: string): string {
  if (value === "none") return "none";
  return value.replace(/_/g, " ");
}

function SummaryMetric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "warning" | "error";
}) {
  const toneClass =
    tone === "error"
      ? "text-state-error"
      : tone === "warning"
        ? "text-state-warning"
        : "text-trace-text";
  return (
    <div className="rounded border border-trace-border/70 bg-trace-bg px-2.5 py-2 min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-trace-muted">
        {label}
      </div>
      <div className={`mt-1 text-sm font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

export default function InvestigationSummary({
  session,
}: InvestigationSummaryProps) {
  const entries = useStore((s) => s.currentEntries);
  const runEvents = useStore((s) => s.currentRunEvents);
  const logs = useStore((s) => s.sessionLogs);
  const navigateToTurn = useStore((s) => s.navigateToTurn);
  const [copied, setCopied] = useState(false);

  const analysisInput = useMemo(
    () => ({
      session,
      entries,
      runEvents,
      logs,
    }),
    [entries, logs, runEvents, session],
  );
  const investigation = useMemo(
    () => analyzeTraceSession(analysisInput),
    [analysisInput],
  );
  const report = useMemo(
    () =>
      buildTraceInvestigationReport(analysisInput, {
        maxFindings: 8,
        maxTurns: 8,
        turnWindow: 1,
      }),
    [analysisInput],
  );

  const topFindings = investigation.findings.slice(0, 4);
  const handleCopyReport = async () => {
    await navigator.clipboard?.writeText(report);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <section className="bg-trace-panel border border-trace-border rounded-lg p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] text-trace-muted uppercase tracking-wide mb-1">
            Investigation
          </div>
          <div className="text-sm text-trace-text font-semibold">
            {investigation.headline}
          </div>
          <div className="mt-1 text-[12px] text-trace-muted leading-relaxed">
            {investigation.recommendedAction}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge
            variant={
              investigation.likelyFailureClass === "none"
                ? "completed"
                : investigation.findings[0]?.severity === "error"
                  ? "error"
                  : "type"
            }
          >
            {formatClass(investigation.likelyFailureClass)}
          </Badge>
          {investigation.firstBadTurn != null && (
            <button
              type="button"
              onClick={() => navigateToTurn(investigation.firstBadTurn!)}
              className="text-[11px] text-trace-accent hover:underline"
            >
              Turn {investigation.firstBadTurn}
            </button>
          )}
          <button
            type="button"
            onClick={handleCopyReport}
            className="text-[11px] text-trace-muted hover:text-trace-accent transition-colors"
          >
            {copied ? "Copied" : "Copy context"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
        <SummaryMetric
          label="Productive"
          value={`${investigation.metrics.productiveTurns}/${investigation.metrics.turnCount}`}
        />
        <SummaryMetric
          label="Tool Failures"
          value={investigation.metrics.toolFailureTurns}
          tone={
            investigation.metrics.toolFailureTurns > 0 ? "error" : "neutral"
          }
        />
        <SummaryMetric
          label="Perception"
          value={`${investigation.metrics.degradedPerceptionTurns}/${investigation.metrics.perceptionTurns}`}
          tone={
            investigation.metrics.degradedPerceptionTurns > 0
              ? "warning"
              : "neutral"
          }
        />
        <SummaryMetric
          label="Context Hot"
          value={investigation.metrics.contextHotTurns}
          tone={
            investigation.metrics.contextHotTurns > 0 ? "warning" : "neutral"
          }
        />
      </div>

      {(investigation.metrics.totalTokens > 0 ||
        investigation.metrics.totalCost > 0 ||
        investigation.metrics.replanCount > 0 ||
        investigation.metrics.doneRejectionCount > 0) && (
        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-trace-muted">
          {investigation.metrics.totalTokens > 0 && (
            <span>
              {formatTokens(investigation.metrics.totalTokens)} tokens
            </span>
          )}
          {investigation.metrics.totalCost > 0 && (
            <span>{formatCost(investigation.metrics.totalCost)}</span>
          )}
          {investigation.metrics.replanCount > 0 && (
            <span>{investigation.metrics.replanCount} replans</span>
          )}
          {investigation.metrics.doneRejectionCount > 0 && (
            <span>
              {investigation.metrics.doneRejectionCount} done rejections
            </span>
          )}
        </div>
      )}

      {topFindings.length > 0 && (
        <div className="mt-3 space-y-2">
          {topFindings.map((finding) => (
            <div
              key={finding.id}
              className={`rounded border px-3 py-2 ${SEVERITY_CLASS[finding.severity]}`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`h-2 w-2 rounded-full shrink-0 ${SEVERITY_DOT[finding.severity]}`}
                />
                <div className="text-[12px] text-trace-text font-medium truncate">
                  {finding.title}
                </div>
                <div className="ml-auto text-[10px] text-trace-muted shrink-0">
                  {Math.round(finding.confidence * 100)}%
                </div>
              </div>
              <div className="mt-1 text-[11px] text-trace-muted leading-relaxed">
                {finding.summary}
              </div>
              {finding.firstTurn != null && (
                <button
                  type="button"
                  onClick={() => navigateToTurn(finding.firstTurn!)}
                  className="mt-1 text-[11px] text-trace-accent hover:underline"
                >
                  Open turn {finding.firstTurn}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
