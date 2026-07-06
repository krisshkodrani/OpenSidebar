/**
 * Perception types.
 *
 * The perception model seat was removed; the only surviving type is the
 * task-context hint the loop threads into prompts.
 */

/** Current plan-step context used to shape prompts (task-conditioned pruning). */
export interface PerceptionTaskContext {
  objective: string;
  successCriteria?: string;
  expectedStateDescription?: string;
  toolProfile?: string;
  currentStepIndex?: number;
  totalSteps?: number;
}
