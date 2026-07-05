import React, { useMemo, useState } from "react";
import type { TraceSession } from "../../../types/traces";
import type { PartialProgressHandoff } from "../../../types";
import Badge from "../Badge";
import Tooltip from "../Tooltip";
import SectionCard, { Eyebrow } from "../SectionCard";
import { useStore } from "../../store";
import {
  formatDuration,
  formatCost,
  formatTokens,
  extractQueryTitle,
  compactTraceTaskLabel,
  truncate,
} from "../../utils";
import InvestigationSummary from "./InvestigationSummary";
import EvidenceTimeline from "./EvidenceTimeline";
import SessionComparisonPanel from "./SessionComparisonPanel";
import TimelineDiffPanel from "./TimelineDiffPanel";
import { buildStepStatuses } from "./PlanTab";

interface OverviewTabProps {
  session: TraceSession;
}

// Status glyphs/colors mirror PlanTab's execution timeline so the Overview
// progress summary and the Plan tab tell the same story for a given trace.
const PLAN_STATUS_ICON: Record<string, string> = {
  completed: "✓",
  "in-progress": "→",
  pending: "○",
  deviated: "↻",
  blocked: "✗",
};

const PLAN_STATUS_TEXT: Record<string, string> = {
  completed: "text-state-success",
  "in-progress": "text-trace-accent",
  pending: "text-trace-muted",
  deviated: "text-state-warning",
  blocked: "text-state-error",
};

// ── Partial Handoff Full Panel ─────────────────────────────────────────────

function PartialHandoffPanel({ handoff }: { handoff: PartialProgressHandoff }) {
  const [copied, setCopied] = useState(false);

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(handoff.suggestedContinuationPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const confidenceClass = (c: string) =>
    c === "high"
      ? "text-state-success"
      : c === "medium"
        ? "text-state-warning"
        : "text-state-error";

  return (
    <SectionCard tone="warning">
      <div className="mb-3 flex items-center gap-2">
        <Eyebrow>Partial Handoff Details</Eyebrow>
        <Badge variant="max_turns">
          {handoff.turnsUsed}/{handoff.maxTurns} turns
        </Badge>
        <span className="text-[10px] text-trace-dim">{handoff.reason}</span>
      </div>

      {/* Uncertainty */}
      {handoff.uncertainty.length > 0 && (
        <div className="mb-3">
          <Eyebrow className="mb-1.5">Uncertainty</Eyebrow>
          <ul className="space-y-1">
            {handoff.uncertainty.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px]">
                <span className={`shrink-0 font-medium ${confidenceClass(item.confidence)}`}>
                  [{item.confidence}]
                </span>
                <span className="text-trace-muted">{item.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Current state */}
      {(handoff.currentState.activeSubtask || handoff.currentState.lastAction) && (
        <div className="mb-3 text-[11px] text-trace-muted flex flex-wrap gap-x-4 gap-y-1 py-2 border-y border-trace-border/50">
          {handoff.currentState.activeSubtask && (
            <span>
              <span className="text-trace-subtle font-medium">Subtask: </span>
              {truncate(handoff.currentState.activeSubtask, 80)}
            </span>
          )}
          {handoff.currentState.lastAction && (
            <span>
              <span className="text-trace-subtle font-medium">Last action: </span>
              {truncate(handoff.currentState.lastAction, 80)}
            </span>
          )}
        </div>
      )}

      {/* Continuation prompt */}
      {handoff.suggestedContinuationPrompt && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <Eyebrow>Continuation Prompt</Eyebrow>
            <button
              type="button"
              onClick={handleCopyPrompt}
              className="text-[10px] text-trace-muted hover:text-trace-accent-light border border-trace-border rounded px-2 py-0.5 transition-colors"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <pre className="p-2.5 bg-trace-bg border border-trace-border rounded text-[11px] text-trace-subtle font-mono leading-relaxed whitespace-pre-wrap break-words overflow-auto max-h-40">
            {handoff.suggestedContinuationPrompt}
          </pre>
        </div>
      )}
    </SectionCard>
  );
}

function getAllSkillIds(session: TraceSession): string[] {
  const ids = new Set<string>();
  if (session.skillToolMetrics?.skillId) {
    ids.add(session.skillToolMetrics.skillId);
  }
  if (session.planDecomposition?.steps) {
    for (const step of session.planDecomposition.steps) {
      if (step.selectedSkillId) {
        ids.add(step.selectedSkillId);
      }
    }
  }
  return Array.from(ids);
}

export default function OverviewTab({ session }: OverviewTabProps) {
  const { title } = extractQueryTitle(session.query || "");
  const duration = formatDuration(
    (session.endTime || 0) - (session.startTime || 0),
  );

  const plan = session.planDecomposition;
  const entries = useStore((s) => s.currentEntries);
  // Real step completion comes from plan_monitor events (same source the Plan
  // tab uses), not from dependency ordering — so the bar tracks execution and
  // agrees with the outcome badge above it.
  const stepStatuses = useMemo(
    () => buildStepStatuses(plan?.steps ?? [], entries),
    [plan, entries],
  );
  const totalSteps = stepStatuses.length;
  const completedSteps = stepStatuses.filter(
    (s) => s.status === "completed",
  ).length;

  const metrics = session.metrics;
  const skillIds = useMemo(() => getAllSkillIds(session), [session]);
  const skills = session.skillToolMetrics;

  return (
    <div className="space-y-4">
      {/* 1. Diagnostic signal first */}
      <InvestigationSummary session={session} />

      {/* 2. Outcome & Metrics compact card */}
      <SectionCard>
        <div className="flex items-center gap-3 flex-wrap">
          <Badge
            variant={
              session.outcome === "completed"
                ? "completed"
                : session.outcome === "error"
                  ? "error"
                  : session.outcome === "max_turns"
                    ? "max_turns"
                    : "stopped"
            }
          >
            {session.outcome}
          </Badge>
          <span className="text-[11px] text-trace-muted">
            {session.turnCount || 0} turns · {duration}
          </span>
          {metrics?.totalCost != null && (
            <span className="text-[11px] text-trace-muted">
              {formatCost(metrics.totalCost) || "$0"}
            </span>
          )}
          {metrics?.totalTokens != null && (
            <span className="text-[11px] text-trace-muted">
              {formatTokens(metrics.totalTokens)} tokens
            </span>
          )}
        </div>
      </SectionCard>

      {/* 3. Evidence timeline */}
      <EvidenceTimeline session={session} />

      {/* 4. Partial handoff (full panel — extends header summary) */}
      {session.partialHandoff && (
        <PartialHandoffPanel handoff={session.partialHandoff} />
      )}

      {/* 5. Skills */}
      {skillIds.length > 0 && (
        <SectionCard title="Skills Used">
          <div className="flex flex-wrap gap-2">
            {skillIds.map((skillId) => (
              <Tooltip
                key={skillId}
                content={
                  <div className="space-y-1">
                    <div className="font-semibold">{skillId}</div>
                    {skills?.skillId === skillId && (
                      <>
                        <div>
                          Preferred:{" "}
                          {Math.round(skills.preferredSelectionRate * 100)}%
                        </div>
                        <div>Total selections: {skills.totalSelections}</div>
                      </>
                    )}
                  </div>
                }
              >
                <span className="inline-flex items-center px-2 py-1 rounded bg-brand-live/10 text-brand-live text-[11px] font-medium cursor-help">
                  {skillId}
                </span>
              </Tooltip>
            ))}
          </div>
        </SectionCard>
      )}

      {/* 6. Plan Progress */}
      {plan && (totalSteps > 0 || (plan.subtasks?.length ?? 0) > 0) && (
        <SectionCard
          title="Plan Progress"
          actions={
            totalSteps > 0 ? (
              <span className="text-[11px] text-trace-subtle">
                {completedSteps}/{totalSteps} steps
              </span>
            ) : undefined
          }
        >
          {totalSteps > 0 ? (
            <>
              <div className="w-full h-2 bg-trace-border/50 rounded-full overflow-hidden">
                <div
                  className="h-full bg-trace-accent rounded-full transition-all"
                  style={{ width: `${(completedSteps / totalSteps) * 100}%` }}
                />
              </div>
              {/* List the same steps the count is derived from, with their real
                  execution status — count and rows can never disagree. */}
              <ol className="mt-3 space-y-1">
                {stepStatuses.map((step) => {
                  const label =
                    compactTraceTaskLabel(step.objective) || step.objective;
                  return (
                    <li
                      key={step.index}
                      className="text-[12px] text-trace-muted flex items-start gap-2"
                      title={
                        label === step.objective ? undefined : step.objective
                      }
                    >
                      <span
                        className={`mt-0.5 shrink-0 ${PLAN_STATUS_TEXT[step.status] ?? "text-trace-muted"}`}
                        title={step.status}
                      >
                        {PLAN_STATUS_ICON[step.status] ?? "○"}
                      </span>
                      {label}
                    </li>
                  );
                })}
              </ol>
            </>
          ) : (
            <ol className="space-y-1">
              {(plan.subtasks ?? []).map((subtask, i) => {
                const label = compactTraceTaskLabel(subtask) || subtask;
                return (
                  <li
                    key={i}
                    className="text-[12px] text-trace-muted flex items-start gap-2"
                    title={label === subtask ? undefined : subtask}
                  >
                    <span className="text-trace-accent mt-0.5">{i + 1}.</span>
                    {label}
                  </li>
                );
              })}
            </ol>
          )}
        </SectionCard>
      )}

      {/* 7. Session comparison */}
      <SessionComparisonPanel session={session} />

      {/* 8. Timeline diff */}
      <TimelineDiffPanel session={session} />

      {/* 9. Query (context reference, not diagnostic) */}
      <SectionCard title="Query">
        <div className="text-sm text-trace-text font-medium">{title}</div>
      </SectionCard>
    </div>
  );
}
