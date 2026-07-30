/**
 * Privacy-safe task terminal facts for optional fleet telemetry (LP-25).
 *
 * This deliberately keeps only enum-like facts. It never retains task text,
 * URLs, DOM content, tool arguments, summaries, or trace records.
 */
import type { UserSettings } from "../../types";
import type { LoopResult } from "../agent/loop-types";
import type { FleetTelemetryProjectionInput } from "../telemetry/projector";
import type { OrchestratorTask } from "./types";

export interface TaskFleetTelemetryState {
  providerId?: string;
  executorModel?: string;
  plannerModel?: string;
  judgeModel?: string;
  turnCount: number;
  completionDecisions: Array<
    NonNullable<FleetTelemetryProjectionInput["completionDecisions"]>[number]
  >;
  evidence: Array<
    NonNullable<FleetTelemetryProjectionInput["evidence"]>[number]
  >;
  errorCodes: string[];
}

export function createTaskFleetTelemetryState(
  settings?: Pick<
    UserSettings,
    "providerMode" | "provider" | "executorModel" | "plannerModel"
  >,
): TaskFleetTelemetryState {
  return {
    providerId: normalizeProviderMode(settings?.providerMode ?? settings?.provider),
    executorModel: settings?.executorModel,
    plannerModel: settings?.plannerModel,
    turnCount: 0,
    completionDecisions: [],
    evidence: [],
    errorCodes: [],
  };
}

export function recordTaskFleetLoopResult(
  state: TaskFleetTelemetryState,
  result: Pick<
    LoopResult,
    "turnCount" | "outcome" | "completionEnvelope" | "evidence"
  >,
): void {
  state.turnCount = Math.min(500, state.turnCount + Math.max(0, result.turnCount));

  if (result.completionEnvelope) {
    state.completionDecisions.push({
      turn: Math.min(500, Math.max(0, result.turnCount)),
      verdict: "accepted",
      candidateSource: result.completionEnvelope.source,
    });
  }
  for (const evidence of result.evidence ?? []) {
    state.evidence.push({
      type: evidence.type,
      observedAtTurn: Math.min(500, Math.max(0, result.turnCount)),
      supportsTaskGoal: true,
    });
  }
  if (result.outcome === "error") state.errorCodes.push("error");
  if (result.outcome === "max_turns") state.errorCodes.push("guardrail_exhausted");
}

export function buildTaskFleetTelemetryProjectionInput(input: {
  task: Pick<OrchestratorTask, "nodes" | "createdAt" | "startedAt" | "finishedAt" | "terminationReason">;
  state: TaskFleetTelemetryState;
  runtime: {
    eventId: string;
    extensionVersion: string;
    extensionChannel: string;
    browserMajor: number;
    osFamily: string;
  };
  completionStatus: "completed" | "partial" | "failed" | "stopped";
}): FleetTelemetryProjectionInput {
  const outcome =
    input.completionStatus === "completed"
      ? "completed"
      : input.completionStatus === "stopped"
        ? "stopped"
        : "error";
  const finishedAt = input.task.finishedAt ?? Date.now();
  const startedAt = input.task.startedAt ?? input.task.createdAt;
  return {
    ...input.runtime,
    providerId: input.state.providerId,
    executorModel: input.state.executorModel,
    plannerModel: input.state.plannerModel,
    judgeModel: input.state.judgeModel,
    plannerStepCount: input.task.nodes.length,
    turnCount: input.state.turnCount,
    durationMs: Math.max(0, finishedAt - startedAt),
    toolExecutions: [],
    completionDecisions: input.state.completionDecisions,
    evidence: input.state.evidence,
    outcome,
    terminalReason:
      outcome === "completed"
        ? "completion_accepted"
        : input.task.terminationReason ?? null,
    errorCodes:
      input.completionStatus === "stopped"
        ? ["user_abort"]
        : input.state.errorCodes,
  };
}

function normalizeProviderMode(value: string | undefined): string | undefined {
  switch (value) {
    case "fireworks-deepseek":
      return "fireworks";
    case "cerebras-fireworks":
      return "cerebras";
    default:
      return value;
  }
}
