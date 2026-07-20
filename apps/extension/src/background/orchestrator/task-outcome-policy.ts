/**
 * Task-outcome policy (issue #45).
 *
 * Derives the terminal completion status of an orchestrated task and turns it
 * into an explicit outcome record for the `task_completed` run-trace event: a
 * success boolean plus a coarse failure classification. Analytics group on the
 * classification instead of parsing free-text termination reasons, and the
 * event stays environment-agnostic (no tab ids, no storage keys).
 */

export type TaskCompletionStatus = "completed" | "partial" | "failed";

export type TaskOutcomeClassification =
  | "completed"
  | "partial_contract"
  | "partial_progress"
  | "max_turns"
  | "stopped_by_user"
  | "verification_failed"
  | "budget_exhausted"
  | "execution_error";

export interface TerminalCounts {
  completed: number;
  failed: number;
  penalizedSkipped: number;
  hasUsefulHandoff: boolean;
}

/** The completed/partial/failed rollup previously inlined in the orchestrator. */
export function deriveCompletionStatus(
  counts: TerminalCounts,
): TaskCompletionStatus {
  if (counts.hasUsefulHandoff) return "partial";
  if (counts.failed > 0) {
    return counts.completed > 0 || counts.penalizedSkipped > 0
      ? "partial"
      : "failed";
  }
  return counts.penalizedSkipped > 0 ? "partial" : "completed";
}

export interface TaskOutcome {
  success: boolean;
  classification: TaskOutcomeClassification;
}

/**
 * Coarse, deterministic classification. Reason matching is intentionally
 * conservative: each branch keys on phrasing the orchestrator itself writes
 * into terminationReason, so an unmatched reason falls through to the honest
 * buckets (partial_progress / execution_error) instead of guessing.
 */
export function classifyTaskOutcome(input: {
  completionStatus: TaskCompletionStatus;
  terminationReason: string | null;
}): TaskOutcome {
  if (input.completionStatus === "completed") {
    return { success: true, classification: "completed" };
  }
  const reason = (input.terminationReason ?? "").toLowerCase();
  if (reason.includes("stopped by user")) {
    return { success: false, classification: "stopped_by_user" };
  }
  if (reason.includes("turn limit")) {
    return { success: false, classification: "max_turns" };
  }
  if (reason.includes("verif")) {
    return { success: false, classification: "verification_failed" };
  }
  if (reason.includes("budget")) {
    return { success: false, classification: "budget_exhausted" };
  }
  if (reason.includes("contract incomplete")) {
    return { success: false, classification: "partial_contract" };
  }
  if (input.completionStatus === "partial") {
    return { success: false, classification: "partial_progress" };
  }
  return { success: false, classification: "execution_error" };
}

export interface TaskCompletedEventInput {
  taskId: string;
  completionStatus: TaskCompletionStatus;
  completed: number;
  failed: number;
  skipped: number;
  totalDurationMs: number;
  totalTokens: number;
  totalCostUsd: number;
  terminationReason: string | null;
}

/** The full `task_completed` payload, outcome classification included. */
export function buildTaskCompletedEventPayload(
  input: TaskCompletedEventInput,
): Record<string, unknown> {
  const outcome = classifyTaskOutcome({
    completionStatus: input.completionStatus,
    terminationReason: input.terminationReason,
  });
  return {
    taskId: input.taskId,
    completionStatus: input.completionStatus,
    success: outcome.success,
    classification: outcome.classification,
    completed: input.completed,
    failed: input.failed,
    skipped: input.skipped,
    totalDurationMs: input.totalDurationMs,
    totalTokens: input.totalTokens,
    totalCostUsd: input.totalCostUsd,
    terminationReason: input.terminationReason,
  };
}
