import React from "react";
import type { TraceSession } from "../../../types/traces";
import Badge from "../Badge";
import Tooltip from "../Tooltip";
import {
  formatDuration,
  formatCost,
  formatTokens,
  extractQueryTitle,
} from "../../utils";

interface OverviewTabProps {
  session: TraceSession;
}

export default function OverviewTab({ session }: OverviewTabProps) {
  const { title } = extractQueryTitle(session.query || "");
  const duration = formatDuration(
    (session.endTime || 0) - (session.startTime || 0),
  );

  const plan = session.planDecomposition;
  const completedSteps =
    plan?.steps?.filter(
      (s) =>
        // Heuristic: steps without dependencies or with completed dependencies
        s.dependencies?.length === 0 ||
        s.dependencies?.every((d) => d < (plan?.steps?.indexOf(s) || 0)),
    ).length || 0;
  const totalSteps = plan?.steps?.length || 0;

  const metrics = session.metrics;
  const skills = session.skillToolMetrics;

  return (
    <div className="space-y-4">
      {/* Query Section */}
      <div className="bg-trace-panel border border-trace-border rounded-lg p-4">
        <div className="text-[11px] text-trace-muted uppercase tracking-wide mb-1">
          Query
        </div>
        <div className="text-sm text-trace-text font-medium">{title}</div>
      </div>

      {/* Outcome & Metrics */}
      <div className="bg-trace-panel border border-trace-border rounded-lg p-4">
        <div className="flex items-center gap-3 mb-3">
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
          {metrics?.totalCost && (
            <span className="text-[11px] text-trace-muted">
              {formatCost(metrics.totalCost)}
            </span>
          )}
          {metrics?.totalTokens && (
            <span className="text-[11px] text-trace-muted">
              {formatTokens(metrics.totalTokens)} tokens
            </span>
          )}
        </div>
      </div>

      {/* Plan Progress */}
      {plan && (
        <div className="bg-trace-panel border border-trace-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] text-trace-muted uppercase tracking-wide">
              Plan Progress
            </div>
            <span className="text-[11px] text-trace-subtle">
              {completedSteps}/{totalSteps} steps
            </span>
          </div>
          <div className="w-full h-2 bg-trace-border/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-trace-accent rounded-full transition-all"
              style={{
                width: `${totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0}%`,
              }}
            />
          </div>
          {plan.subtasks?.length > 0 && (
            <ol className="mt-3 space-y-1">
              {plan.subtasks.map((subtask, i) => (
                <li
                  key={i}
                  className="text-[12px] text-trace-muted flex items-start gap-2"
                >
                  <span className="text-trace-accent mt-0.5">{i + 1}.</span>
                  {subtask}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {/* Skills */}
      {skills && (
        <div className="bg-trace-panel border border-trace-border rounded-lg p-4">
          <div className="text-[11px] text-trace-muted uppercase tracking-wide mb-2">
            Skills Used
          </div>
          <div className="flex flex-wrap gap-2">
            <Tooltip
              content={
                <div className="space-y-1">
                  <div className="font-semibold">{skills.skillId}</div>
                  <div>
                    Preferred: {Math.round(skills.preferredSelectionRate * 100)}
                    %
                  </div>
                  <div>Total selections: {skills.totalSelections}</div>
                </div>
              }
            >
              <span className="inline-flex items-center px-2 py-1 rounded bg-brand-live/10 text-brand-live text-[11px] font-medium cursor-help">
                {skills.skillId}
              </span>
            </Tooltip>
          </div>
        </div>
      )}

      {/* Timeline placeholder - will be enhanced later */}
      <div className="bg-trace-panel border border-trace-border rounded-lg p-4">
        <div className="text-[11px] text-trace-muted uppercase tracking-wide mb-2">
          Session Timeline
        </div>
        <div className="text-[12px] text-trace-muted">
          Timeline visualization coming soon...
        </div>
      </div>
    </div>
  );
}
