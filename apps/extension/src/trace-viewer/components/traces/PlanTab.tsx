import React from "react";
import type { TraceSession, TraceEntry } from "../../../types/traces";
import Badge from "../Badge";
import Tooltip from "../Tooltip";
import { useStore } from "../../store";

interface PlanTabProps {
  session: TraceSession;
}

interface PlanStepWithStatus {
  index: number;
  objective: string;
  successCriteria?: string;
  selectedSkillId?: string;
  dependencies: number[];
  status: "completed" | "in-progress" | "pending" | "deviated" | "blocked";
  alignment?: "aligned" | "progressing" | "deviated" | "blocked";
  turnRange?: { start: number; end: number };
}

export default function PlanTab({ session }: PlanTabProps) {
  const currentEntries = useStore((s) => s.currentEntries);
  const plan = session.planDecomposition;

  if (!plan || !plan.steps || plan.steps.length === 0) {
    return (
      <div className="text-sm text-trace-muted p-4">
        No plan decomposition available for this session.
      </div>
    );
  }

  // Build step statuses from plan_monitor events
  const steps = buildStepStatuses(plan.steps || [], currentEntries);

  // Find replan events
  const replanEvents = currentEntries.flatMap((entry) =>
    (entry.events || []).filter((e) => e.type === "plan_replan"),
  );

  return (
    <div className="space-y-4">
      {/* Plan Header */}
      <div className="bg-trace-panel border border-trace-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] text-trace-muted uppercase tracking-wide">
            Plan Decomposition
          </span>
          {session.difficultyAssessment && (
            <Badge
              variant={`difficulty-${session.difficultyAssessment.toLowerCase()}`}
            >
              {session.difficultyAssessment}
            </Badge>
          )}
        </div>
        <div className="text-[12px] text-trace-muted">
          {plan.subtasks?.length > 0 && (
            <ol className="list-decimal list-inside space-y-1">
              {plan.subtasks.map((subtask, i) => (
                <li key={i}>{subtask}</li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {/* Plan Timeline */}
      <div className="bg-trace-panel border border-trace-border rounded-lg p-4">
        <div className="text-[11px] text-trace-muted uppercase tracking-wide mb-3">
          Execution Timeline
        </div>
        <div className="space-y-3">
          {steps.map((step) => (
            <PlanStepCard key={step.index} step={step} />
          ))}
        </div>
      </div>

      {/* Replan Events */}
      {replanEvents.length > 0 && (
        <div className="bg-trace-panel border border-trace-border rounded-lg p-4">
          <div className="text-[11px] text-trace-muted uppercase tracking-wide mb-2">
            Replan Events
          </div>
          <div className="space-y-2">
            {replanEvents.map((event, i) => {
              const data = event.data as {
                fromIndex: number;
                newStepCount: number;
                reason: string;
                replanNumber: number;
              };
              return (
                <div
                  key={i}
                  className="flex items-start gap-2 p-2 bg-state-warning/10 border border-state-warning/25 rounded"
                >
                  <span className="text-state-warning text-lg">⚠</span>
                  <div>
                    <div className="text-[12px] font-medium text-trace-text">
                      Replan #{data.replanNumber}
                    </div>
                    <div className="text-[11px] text-trace-muted">
                      From step {data.fromIndex + 1} · {data.newStepCount} new
                      steps
                    </div>
                    <div className="text-[11px] text-trace-subtle mt-1">
                      {data.reason}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PlanStepCard({ step }: { step: PlanStepWithStatus }) {
  const navigateToTurn = useStore((s) => s.navigateToTurn);

  const statusColors = {
    completed: "bg-state-success/20 border-state-success/50 text-state-success",
    "in-progress":
      "bg-trace-accent/10 border-trace-accent/50 text-trace-accent",
    pending: "bg-trace-border/30 border-trace-border text-trace-muted",
    deviated: "bg-state-warning/20 border-state-warning/50 text-state-warning",
    blocked: "bg-state-error/20 border-state-error/50 text-state-error",
  };

  const statusIcons = {
    completed: "✓",
    "in-progress": "→",
    pending: "○",
    deviated: "↻",
    blocked: "✗",
  };

  return (
    <div className={`border rounded-lg p-3 ${statusColors[step.status]}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2">
          <span className="text-lg font-bold mt-0.5">
            {statusIcons[step.status]}
          </span>
          <div>
            <div className="text-[13px] font-medium">
              Step {step.index + 1}: {step.objective}
            </div>
            {step.successCriteria && (
              <div className="text-[11px] opacity-80 mt-0.5">
                Success: {step.successCriteria}
              </div>
            )}
            {step.dependencies.length > 0 && (
              <div className="text-[11px] opacity-70 mt-0.5">
                Depends on:{" "}
                {step.dependencies.map((d) => `Step ${d + 1}`).join(", ")}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {step.selectedSkillId && (
            <Tooltip content="Skill used for this step">
              <span className="px-1.5 py-0.5 rounded bg-brand-live/20 text-brand-live text-[10px] font-medium cursor-help">
                {step.selectedSkillId}
              </span>
            </Tooltip>
          )}
          {step.turnRange && (
            <button
              onClick={() => navigateToTurn(step.turnRange!.start)}
              className="text-[11px] underline opacity-70 hover:opacity-100"
            >
              Turns {step.turnRange.start}-{step.turnRange.end}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function buildStepStatuses(
  steps: Array<{
    objective: string;
    successCriteria?: string;
    selectedSkillId?: string;
    dependencies: number[];
  }>,
  entries: TraceEntry[],
): PlanStepWithStatus[] {
  // Track current step from plan_monitor events
  let currentStepIndex = 0;
  const stepAlignments = new Map<
    number,
    "aligned" | "progressing" | "deviated" | "blocked"
  >();

  // Process plan_monitor events to determine alignment
  for (const entry of entries) {
    for (const event of entry.events || []) {
      if (event.type === "plan_monitor") {
        const data = event.data as {
          stepIndex: number;
          alignment: "aligned" | "progressing" | "deviated" | "blocked";
        };
        stepAlignments.set(data.stepIndex, data.alignment);
        if (data.alignment === "aligned" || data.alignment === "progressing") {
          currentStepIndex = Math.max(currentStepIndex, data.stepIndex);
        }
      }
    }
  }

  // Build step statuses
  return steps.map((step, index) => {
    const alignment = stepAlignments.get(index);
    let status: PlanStepWithStatus["status"] = "pending";

    if (alignment === "aligned") {
      status = "completed";
    } else if (alignment === "progressing") {
      status = "in-progress";
    } else if (alignment === "deviated") {
      status = "deviated";
    } else if (alignment === "blocked") {
      status = "blocked";
    } else if (index < currentStepIndex) {
      status = "completed";
    } else if (index === currentStepIndex) {
      status = "in-progress";
    }

    // Find turn range for this step (heuristic)
    const turnRange = findTurnRangeForStep(index, entries);

    return {
      index,
      objective: step.objective,
      successCriteria: step.successCriteria,
      selectedSkillId: step.selectedSkillId,
      dependencies: step.dependencies,
      status,
      alignment,
      turnRange,
    };
  });
}

function findTurnRangeForStep(
  stepIndex: number,
  entries: TraceEntry[],
): { start: number; end: number } | undefined {
  // Heuristic: find turns where plan_monitor mentions this step
  const relevantTurns = entries
    .filter((entry) =>
      (entry.events || []).some(
        (e) =>
          e.type === "plan_monitor" &&
          (e.data as { stepIndex: number }).stepIndex === stepIndex,
      ),
    )
    .map((e) => e.turnNumber);

  if (relevantTurns.length === 0) return undefined;

  return {
    start: Math.min(...relevantTurns),
    end: Math.max(...relevantTurns),
  };
}
