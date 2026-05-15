import React from "react";
import type { TraceSession, TraceEntry } from "../../../types/traces";
import type { RunTraceEvent } from "../../../utils/run-trace";
import Badge from "../Badge";
import Tooltip from "../Tooltip";
import { useStore } from "../../store";
import { formatCost, formatDuration, formatTokens } from "../../utils";

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
  const currentRunEvents = useStore((s) => s.currentRunEvents);
  const plan = session.planDecomposition;

  if (!plan || !plan.steps || plan.steps.length === 0) {
    if (currentRunEvents.length > 0) {
      return <RunPlannerActivity runEvents={currentRunEvents} />;
    }

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

      {currentRunEvents.length > 0 && (
        <>
          <ParallelWorkerTimeline runEvents={currentRunEvents} />
          <RunEventTimeline runEvents={currentRunEvents} compact />
        </>
      )}
    </div>
  );
}

function ParallelWorkerTimeline({
  runEvents,
}: {
  runEvents: RunTraceEvent[];
}) {
  const workerEvents = runEvents.filter((event) =>
    [
      "worker_queued",
      "worker_started",
      "worker_blocked_resource",
      "worker_released_resource",
      "worker_cancelled",
      "node_verified",
      "scheduler_executor_lane_retry",
    ].includes(event.type),
  );
  if (workerEvents.length === 0) return null;

  const activeCounts = workerEvents
    .map((event) => numberValue(asRecord(event.data)?.activeWorkerCount))
    .filter((value): value is number => value != null);
  const maxActive = activeCounts.length > 0 ? Math.max(...activeCounts) : 0;
  const queued = workerEvents.filter(
    (event) => event.type === "worker_queued",
  ).length;
  const blocked = workerEvents.filter(
    (event) => event.type === "worker_blocked_resource",
  ).length;
  const verifierCalls = workerEvents.filter(
    (event) => event.type === "node_verified",
  ).length;
  const retries = workerEvents.filter(
    (event) => event.type === "scheduler_executor_lane_retry",
  ).length;

  return (
    <div className="bg-trace-panel border border-trace-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-[11px] text-trace-muted uppercase tracking-wide">
          Parallel Workers
        </span>
        <Badge variant={maxActive >= 2 ? "completed" : "type"}>
          {maxActive >= 2 ? "overlap observed" : "serialized"}
        </Badge>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[11px]">
        <RunMetricCard
          label="Max Active"
          value={maxActive}
          hint="worker overlap"
        />
        <RunMetricCard label="Queued" value={queued} hint="lane queue events" />
        <RunMetricCard
          label="Resource Blocks"
          value={blocked}
          hint="scheduler waits"
        />
        <RunMetricCard
          label="Verifier"
          value={verifierCalls}
          hint="node checks"
        />
        <RunMetricCard label="Retries" value={retries} hint="lane recovery" />
      </div>
      <div className="mt-3 space-y-2">
        {workerEvents.slice(0, 10).map((event, index) => (
          <div
            key={`${event.type}-${event.ts}-${index}`}
            className="rounded border border-trace-border/70 bg-trace-bg px-3 py-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-[10px] text-trace-muted shrink-0">
                {formatEventTime(event)}
              </span>
              <Badge variant="role-executor">{event.type}</Badge>
              <span className="text-[11px] text-trace-muted truncate">
                {parallelWorkerEventSummary(event)}
              </span>
            </div>
          </div>
        ))}
      </div>
      {workerEvents.length > 10 && (
        <div className="mt-2 text-[11px] text-trace-muted">
          Showing first 10 of {workerEvents.length} worker events.
        </div>
      )}
    </div>
  );
}

function RunPlannerActivity({
  runEvents,
}: {
  runEvents: RunTraceEvent[];
}) {
  const planEvent = [...runEvents]
    .reverse()
    .find((event) => event.type === "plan_decomposed");
  const planData = asRecord(planEvent?.data);
  const nodeCount = numberValue(planData?.nodeCount);
  const difficulty = stringValue(planData?.difficulty);
  const structured = booleanValue(planData?.structured);
  const fallback = booleanValue(planData?.fallback);
  const skills = Array.isArray(planData?.skills) ? planData.skills : [];
  const plannerEvents = runEvents.filter(
    (event) => event.role === "planner" || event.type === "plan_decomposed",
  );
  const plannerLlmEvents = runEvents.filter(
    (event) => event.type === "planner_llm_call",
  );
  const executorEvents = runEvents.filter(
    (event) => event.role === "executor" || event.type.startsWith("node_"),
  );
  const verifierEvents = runEvents.filter(
    (event) =>
      event.role === "verifier" ||
      event.type.includes("verified") ||
      event.type.includes("advisory"),
  );

  return (
    <div className="space-y-4">
      <div className="bg-trace-panel border border-trace-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="text-[11px] text-trace-muted uppercase tracking-wide">
            Run Planner Activity
          </span>
          <Badge variant="tier-planner">run trace</Badge>
          {difficulty && (
            <Badge variant={`difficulty-${difficulty.toLowerCase()}`}>
              {difficulty}
            </Badge>
          )}
          {structured != null && (
            <Badge variant="type">
              {structured ? "structured" : "fallback"}
            </Badge>
          )}
          {fallback && <Badge variant="max_turns">fallback</Badge>}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[11px]">
          <RunMetricCard
            label="Planner Events"
            value={plannerEvents.length}
            hint={planEvent ? formatEventTime(planEvent) : "none recorded"}
          />
          <RunMetricCard
            label="Planner LLM"
            value={plannerLlmEvents.length}
            hint={plannerLlmEvents.length > 0 ? "model calls" : "none recorded"}
          />
          <RunMetricCard
            label="Plan Nodes"
            value={nodeCount ?? "-"}
            hint="decomposed graph"
          />
          <RunMetricCard
            label="Executor Events"
            value={executorEvents.length}
            hint="node lifecycle"
          />
          <RunMetricCard
            label="Verifier Events"
            value={verifierEvents.length}
            hint={`${skills.length} skill pick${skills.length === 1 ? "" : "s"}`}
          />
        </div>
        {!planEvent && (
          <div className="mt-3 text-[12px] text-trace-muted">
            No plan_decomposed event was found in this run trace.
          </div>
        )}
      </div>

      {plannerLlmEvents.length > 0 && (
        <PlannerLlmCalls runEvents={plannerLlmEvents} />
      )}

      <ParallelWorkerTimeline runEvents={runEvents} />

      {skills.length > 0 && (
        <div className="bg-trace-panel border border-trace-border rounded-lg p-4">
          <div className="text-[11px] text-trace-muted uppercase tracking-wide mb-2">
            Planner Skill Picks
          </div>
          <div className="space-y-2">
            {skills.map((skill, index) => {
              const record = asRecord(skill);
              const skillId = stringValue(record?.skillId) ?? "unknown";
              const reason = stringValue(record?.reason);
              const nodeId = stringValue(record?.nodeId);
              return (
                <div
                  key={`${skillId}-${nodeId ?? index}`}
                  className="rounded border border-trace-border/70 bg-trace-bg px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="category">{skillId}</Badge>
                    {nodeId && (
                      <span className="font-mono text-[10px] text-trace-muted">
                        {nodeId.slice(0, 8)}
                      </span>
                    )}
                  </div>
                  {reason && (
                    <div className="mt-1 text-[11px] text-trace-muted leading-relaxed">
                      {reason}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <RunEventTimeline runEvents={runEvents} />
    </div>
  );
}

function PlannerLlmCalls({ runEvents }: { runEvents: RunTraceEvent[] }) {
  return (
    <div className="bg-trace-panel border border-trace-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px] text-trace-muted uppercase tracking-wide">
          Planner LLM Calls
        </span>
        <Badge variant="tier-planner">{runEvents.length} calls</Badge>
      </div>
      <div className="space-y-2">
        {runEvents.map((event, index) => {
          const data = asRecord(event.data);
          const usage = asRecord(data?.usage);
          const phase = stringValue(data?.phase) ?? "planner";
          const model = stringValue(data?.model) ?? "unknown";
          const duration = numberValue(data?.durationMs);
          const totalTokens = numberValue(usage?.total_tokens);
          const cost = numberValue(usage?.cost);
          return (
            <div
              key={`${event.ts}-${index}`}
              className="rounded border border-trace-border/70 bg-trace-bg px-3 py-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-[10px] text-trace-muted shrink-0">
                  {formatEventTime(event)}
                </span>
                <Badge variant="tier-planner">{phase}</Badge>
                <span className="font-mono text-[11px] text-trace-accent-light truncate">
                  {model}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-trace-muted">
                {duration != null && <span>{formatDuration(duration)}</span>}
                {totalTokens != null && (
                  <span>{formatTokens(totalTokens)} tokens</span>
                )}
                {cost != null && <span>{formatCost(cost)}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RunMetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint: string;
}) {
  return (
    <div className="rounded border border-trace-border/70 bg-trace-bg px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-trace-muted">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-trace-text">{value}</div>
      <div className="mt-1 text-[10px] text-trace-muted">{hint}</div>
    </div>
  );
}

function RunEventTimeline({
  runEvents,
  compact = false,
}: {
  runEvents: RunTraceEvent[];
  compact?: boolean;
}) {
  const events = compact ? runEvents.slice(0, 12) : runEvents;

  if (events.length === 0) return null;

  return (
    <div className="bg-trace-panel border border-trace-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px] text-trace-muted uppercase tracking-wide">
          Run Event Timeline
        </span>
        <Badge variant="type">{runEvents.length} events</Badge>
      </div>
      <div className="space-y-2">
        {events.map((event, index) => (
          <RunEventRow key={`${event.type}-${event.ts}-${index}`} event={event} />
        ))}
      </div>
      {compact && runEvents.length > events.length && (
        <div className="mt-2 text-[11px] text-trace-muted">
          Showing first {events.length} of {runEvents.length} run events.
        </div>
      )}
    </div>
  );
}

function RunEventRow({ event }: { event: RunTraceEvent }) {
  const role = event.role ?? "system";

  return (
    <div className="rounded border border-trace-border/70 bg-trace-bg px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-mono text-[10px] text-trace-muted shrink-0">
          {formatEventTime(event)}
        </span>
        <Badge variant={role === "planner" ? "tier-planner" : `role-${role}`}>
          {role}
        </Badge>
        <span className="font-mono text-[11px] text-trace-accent-light truncate">
          {event.type}
        </span>
      </div>
      <div className="mt-1 text-[11px] text-trace-muted leading-relaxed">
        {summarizeRunEvent(event)}
      </div>
    </div>
  );
}

function summarizeRunEvent(event: RunTraceEvent): string {
  const data = asRecord(event.data);
  if (!data) return "No event data.";

  if (event.type === "plan_decomposed") {
    const nodeCount = numberValue(data.nodeCount);
    const difficulty = stringValue(data.difficulty);
    const structured = booleanValue(data.structured);
    const skills = Array.isArray(data.skills) ? data.skills.length : 0;
    return [
      structured == null
        ? "Planner emitted a decomposition."
        : structured
          ? "Planner emitted a structured decomposition."
          : "Planner emitted a fallback decomposition.",
      nodeCount == null ? null : `${nodeCount} node${nodeCount === 1 ? "" : "s"}.`,
      difficulty ? `Difficulty: ${difficulty}.` : null,
      `${skills} skill pick${skills === 1 ? "" : "s"}.`,
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (event.type === "planner_llm_call") {
    const phase = stringValue(data.phase) ?? "planner";
    const model = stringValue(data.model) ?? "unknown model";
    const duration = numberValue(data.durationMs);
    const usage = asRecord(data.usage);
    const totalTokens = numberValue(usage?.total_tokens);
    const cost = numberValue(usage?.cost);
    return [
      `Planner LLM call for ${phase}.`,
      `Model: ${model}.`,
      duration != null ? `Duration ${formatDuration(duration)}.` : null,
      totalTokens != null ? `${formatTokens(totalTokens)} tokens.` : null,
      cost != null ? `${formatCost(cost)}.` : null,
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (event.type === "node_started") {
    const nodeId = stringValue(data.nodeId);
    const retries = numberValue(data.retries);
    const deps = numberValue(data.dependencyCount);
    return [
      `Node ${shortId(nodeId)} started.`,
      retries && retries > 0 ? `Retry ${retries}.` : null,
      deps != null ? `${deps} dependencies.` : null,
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (event.type === "node_completed") {
    const nodeId = stringValue(data.nodeId);
    const outcome = stringValue(data.outcome) ?? "completed";
    const duration = numberValue(data.durationMs);
    const summary = stringValue(data.summary);
    return [
      `Node ${shortId(nodeId)} ${outcome}.`,
      duration != null ? `Duration ${formatDuration(duration)}.` : null,
      summary ? clip(summary, 180) : null,
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (event.type === "node_verified") {
    const nodeId = stringValue(data.nodeId);
    const decision = stringValue(data.decision) ?? "checked";
    const confidence = numberValue(data.confidence);
    const reason = stringValue(data.reason);
    return [
      `Verifier ${decision} node ${shortId(nodeId)}.`,
      confidence != null ? `${Math.round(confidence * 100)}% confidence.` : null,
      reason ? clip(reason, 180) : null,
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (event.type === "advisory_issued") {
    const nodeId = stringValue(data.nodeId);
    const retries = numberValue(data.retries);
    return [
      `Verifier issued advisory for node ${shortId(nodeId)}.`,
      retries != null ? `Retries: ${retries}.` : null,
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (
    [
      "worker_queued",
      "worker_started",
      "worker_blocked_resource",
      "worker_released_resource",
      "worker_cancelled",
    ].includes(event.type)
  ) {
    return parallelWorkerEventSummary(event);
  }

  if (
    event.type === "node_failure_attribution" ||
    event.type === "scheduler_dependency_failed"
  ) {
    const nodeId = stringValue(data.nodeId);
    const reason = stringValue(data.reason) ?? "dependency failed";
    const failedDeps = arraySummary(data.failedDeps);
    return [
      `Node ${shortId(nodeId)} blocked: ${reason}.`,
      failedDeps ? `Failed dependencies: ${failedDeps}.` : null,
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (event.type === "task_completed") {
    const status = stringValue(data.completionStatus) ?? "unknown";
    const completed = numberValue(data.completed);
    const failed = numberValue(data.failed);
    const total = numberValue(data.total);
    const duration = numberValue(data.totalDurationMs);
    return [
      `Task completed with status ${status}.`,
      completed != null && failed != null && total != null
        ? `${completed} completed, ${failed} failed, ${total} total.`
        : null,
      duration != null ? `Duration ${formatDuration(duration)}.` : null,
    ]
      .filter(Boolean)
      .join(" ");
  }

  return clip(JSON.stringify(data), 220);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function shortId(value: string | null): string {
  return value ? value.slice(0, 8) : "unknown";
}

function clip(value: string, maxLength: number): string {
  return value.length > maxLength
    ? `${value.slice(0, Math.max(0, maxLength - 3))}...`
    : value;
}

function arraySummary(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value
    .map((item) => (typeof item === "string" ? item.slice(0, 8) : String(item)))
    .join(", ");
}

function resourceLockSummary(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "no active locks";
  return value
    .slice(0, 3)
    .map((item) => {
      const record = asRecord(item);
      const nodeId = shortId(stringValue(record?.nodeId));
      const resources = Array.isArray(record?.resources)
        ? record.resources.length
        : 0;
      return `${nodeId}:${resources}`;
    })
    .join(", ");
}

function parallelWorkerEventSummary(event: RunTraceEvent): string {
  const data = asRecord(event.data);
  const nodeId = shortId(stringValue(data?.nodeId));
  const workerId = shortId(stringValue(data?.workerId));
  const active = numberValue(data?.activeWorkerCount);
  const locks = resourceLockSummary(data?.resourceLocks);
  const reason = stringValue(data?.reason);

  if (event.type === "worker_blocked_resource") {
    const conflicts = Array.isArray(data?.conflicts)
      ? data.conflicts.length
      : 0;
    return `Node ${nodeId} blocked by ${conflicts} resource conflict${conflicts === 1 ? "" : "s"}; active=${active ?? "?"}; locks=${locks}.`;
  }
  if (event.type === "worker_cancelled") {
    return `Worker ${workerId} for node ${nodeId} cancelled${reason ? `: ${reason}` : ""}; active=${active ?? "?"}; locks=${locks}.`;
  }
  if (event.type === "worker_released_resource") {
    return `Worker ${workerId} released node ${nodeId}; active=${active ?? "?"}; locks=${locks}.`;
  }
  if (event.type === "worker_started") {
    return `Worker ${workerId} started node ${nodeId}; active=${active ?? "?"}; locks=${locks}.`;
  }
  if (event.type === "worker_queued") {
    return `Node ${nodeId} queued; active=${active ?? "?"}; locks=${locks}.`;
  }
  if (event.type === "node_verified") {
    const decision = stringValue(data?.decision) ?? "checked";
    return `Verifier ${decision} node ${nodeId}.`;
  }
  if (event.type === "scheduler_executor_lane_retry") {
    return `Executor lane retry scheduled for node ${nodeId}.`;
  }
  return clip(JSON.stringify(data), 180);
}

function formatEventTime(event: RunTraceEvent): string {
  const raw = event.ts || event.recordedAt;
  if (!raw) return "--:--:--";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
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

  const handleSkillClick = (skillId: string) => {
    window.location.hash = `skill=${skillId}`;
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
              <button
                onClick={() => handleSkillClick(step.selectedSkillId!)}
                className="px-1.5 py-0.5 rounded bg-brand-live/20 text-brand-live text-[10px] font-medium cursor-help hover:underline"
              >
                {step.selectedSkillId}
              </button>
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
