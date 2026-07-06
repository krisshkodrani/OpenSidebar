/**
 * CompletionGuardContext (RFC LP-15, Phase 7a).
 *
 * The precomputed, environment-agnostic input surface every completion guard
 * reads. The pipeline runner assembles ONE of these per `done()` from the loop
 * (resolving the loop-coupled derivations — task context, missing evidence,
 * active objective — up front) and threads it through each pure guard. Guards
 * never touch `AgentLoop`; anything impure (the ServiceNow evidence inference,
 * the planner model call) runs as an injected pre-step and lands its result
 * here.
 *
 * Fields are added as guards are ported; keep it flat and serializable so a
 * context can be reconstructed from a decision record in replay.
 */

import type { DomSnapshot } from "../../../../types";

export interface CompletionGuardContext {
  /** The done() summary under evaluation. */
  summary: string;
  /** The original root user request (`originalQuery`). */
  userRequest: string;
  /** Current page snapshot. */
  snapshot: DomSnapshot | null;
  /** Precomputed completion-summary task context (`getCompletionSummaryTaskContext()`). */
  taskContext: string;
  /** Current turn index. */
  turnCount: number;
  /** True when running as an orchestrator sub-node (`Boolean(nodeId)`). */
  isOrchestratorNode: boolean;

  /** Done-rejection counter (pre-increment, as the guard sees it). */
  doneRejections: number;
  /** Hard rejection cap (`limits.maxDoneRejections`). */
  maxDoneRejections: number;
  /** Same-kind bounce counter (kernel bypass gate). */
  consecutiveSameKindRejections: number;
  /** Kind of the last contract rejection (kernel bypass gate). */
  lastContractRejectionKind: string | null;

  /** Number of plan subtasks (0 = no plan). */
  planSubtaskCount: number;
  /** Index of the running plan subtask, or -1 when none is running. */
  runningSubtaskIndex: number;

  /** The selected skill/workflow id, if any. */
  selectedSkillId: string | null;

  /** Grounding guard: whether the agent has read substantive page content. */
  hasReadPage: boolean;
  hasExplicitPageRead: boolean;
  /** Whether a durable task id is set (`Boolean(taskId)`). */
  hasTaskId: boolean;

  /**
   * Required typed-evidence kinds still missing, precomputed AFTER the injected
   * ServiceNow inference pre-step has had a chance to add evidence.
   */
  missingRequiredEvidence: string[];

  /** Active objective for the current plan step (autocomplete guard). */
  activeObjective?: string;
  /** Success criteria for the current plan step (autocomplete guard). */
  successCriteria?: string;

  /** List-detail review counts (list-detail guard), precomputed from the loop. */
  listDetailReviewedCount: number;
  listDetailOpenedCount: number;
  /** max(tracked, countVisibleListDetailActions(snapshot)). */
  listDetailVisibleActionCount: number;

  /**
   * Money-table aggregate reject reasons, precomputed from the loop's tracked
   * aggregate. `incorrectAnswerReason` is already null when the scan is
   * incomplete (the legacy short-circuit).
   */
  moneyTableIncompleteScanReason: string | null;
  moneyTableIncorrectAnswerReason: string | null;
}
