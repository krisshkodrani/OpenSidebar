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
import SectionCard, { Eyebrow } from "../SectionCard";
import StatTile from "../StatTile";

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

const SOURCE_LABEL: Record<NonNullable<InvestigationFinding["source"]>, string> =
  {
    deterministic: "deterministic",
    heuristic: "heuristic",
    llm_verifier: "LLM verifier",
  };

function formatClass(value: string): string {
  if (value === "none") return "none";
  return value.replace(/_/g, " ");
}

export default function InvestigationSummary({
  session,
}: InvestigationSummaryProps) {
  const entries = useStore((s) => s.currentEntries);
  const runEvents = useStore((s) => s.currentRunEvents);
  const logs = useStore((s) => s.sessionLogs);
  const navigateToTurn = useStore((s) => s.navigateToTurn);
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

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

  const [showAllFindings, setShowAllFindings] = useState(false);
  const topFindings = showAllFindings
    ? investigation.findings
    : investigation.findings.slice(0, 4);
  const hiddenFindingCount = investigation.findings.length - topFindings.length;
  const handleCopyReport = async () => {
    await navigator.clipboard?.writeText(report);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const handleCopyLink = async () => {
    const params = new URLSearchParams();
    params.set("session", session.sessionId);
    if (investigation.firstBadTurn != null) {
      params.set("view", "turns");
      params.set("turn", String(investigation.firstBadTurn));
    }
    const url = `${window.location.origin}${window.location.pathname}#${params.toString()}`;
    await navigator.clipboard?.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 1200);
  };

  return (
    <SectionCard>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow className="mb-1">Investigation</Eyebrow>
          <div className="text-sm text-trace-text font-semibold">
            {investigation.headline}
          </div>
          <div className="mt-1 text-[12px] text-trace-subtle leading-relaxed">
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
          <button
            type="button"
            onClick={handleCopyLink}
            className="text-[11px] text-trace-muted hover:text-trace-accent transition-colors"
          >
            {copiedLink ? "Link copied" : "Copy link"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
        <StatTile
          label="Productive"
          value={`${investigation.metrics.productiveTurns}/${investigation.metrics.turnCount}`}
        />
        <StatTile
          label="Tool Failures"
          value={investigation.metrics.toolFailureTurns}
          tone={
            investigation.metrics.toolFailureTurns > 0 ? "error" : "neutral"
          }
        />
        <StatTile
          label="Perception"
          value={`${investigation.metrics.degradedPerceptionTurns}/${investigation.metrics.perceptionTurns}`}
          tone={
            investigation.metrics.degradedPerceptionTurns > 0
              ? "warning"
              : "neutral"
          }
        />
        <StatTile
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
                  {finding.source ? SOURCE_LABEL[finding.source] : "unknown"} -{" "}
                  {Math.round(finding.confidence * 100)}%
                </div>
              </div>
              <div className="mt-1 text-[11px] text-trace-muted leading-relaxed">
                {finding.summary}
              </div>
              {finding.evidence.some(
                (evidence) => evidence.resolved === false,
              ) && (
                <div className="mt-1 text-[11px] text-state-warning">
                  Evidence unavailable:{" "}
                  {finding.evidence
                    .filter((evidence) => evidence.resolved === false)
                    .map(
                      (evidence) =>
                        evidence.resolutionDetail ??
                        evidence.resolutionStatus ??
                        evidence.label,
                    )
                    .join("; ")}
                </div>
              )}
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
          {(hiddenFindingCount > 0 || showAllFindings) &&
            investigation.findings.length > 4 && (
              <button
                type="button"
                onClick={() => setShowAllFindings((prev) => !prev)}
                className="text-[11px] text-trace-accent hover:underline"
              >
                {showAllFindings
                  ? "Show fewer findings"
                  : `Show all ${investigation.findings.length} findings`}
              </button>
            )}
        </div>
      )}
    </SectionCard>
  );
}
