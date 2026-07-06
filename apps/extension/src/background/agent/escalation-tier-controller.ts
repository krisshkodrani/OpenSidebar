/**
 * EscalationTierController (RFC LP-15, Phase 6).
 *
 * Owns the state of the two-tier (0=executor / 1=planner) escalation machine
 * that previously lived as ~10 interdependent locals threaded through
 * `AgentLoop.loop()`. Phase 6 migrates the STATE here first (this file); the
 * cohesive transition policies (cooldown tick, orientation handoff, progress-
 * gated de-escalation with exponential backoff, fresh-start) move in as methods
 * in a follow-up step, each behavior-preserving and guarded by the escalation
 * characterization net.
 *
 * The fields are public and mutable because the loop still drives most
 * transitions inline during the migration; the controller is the single home
 * for the state, not (yet) the single owner of every mutation. The escalation
 * ENTRY is already single-sourced by `beginPlannerEscalation()` in the loop.
 *
 * NOT absorbed: `EscalationRescueTracker` (escalation-rescue-policy.ts) is a
 * separate, already-clean system the loop calls into directly.
 */

export interface EscalationTierControllerOptions {
  /**
   * Start on the planner tier for the plan-then-act orientation phase. False
   * when the orchestrator requests `preferredModelTier="executor"` (skip
   * orientation entirely).
   */
  startOnPlanner: boolean;
  /** Baseline orientation length (`ORIENTATION.PHASE_TURNS`). */
  orientationPhaseTurns: number;
}

export class EscalationTierController {
  /** Current tier: 0 = executor, 1 = planner. */
  tier: number;
  /** True during the initial planner-model orientation phase. */
  orientationPhase: boolean;
  /** Turns remaining before executor→planner escalation is permitted again. */
  cooldownRemaining = 0;
  /** De-escalation cycle count — drives the exponential cooldown backoff. */
  escalationCycles = 0;
  /** Turn at which the current planner escalation fired (tenure baseline). */
  plannerModelStartTurn = 0;
  /** Consecutive progress signals accumulated toward the de-escalation gate. */
  consecutiveProgressSignals = 0;
  /** S3 fresh-start recovery counter. */
  freshStartCount = 0;
  /** Whether the agent is currently flagged stuck (for the "resolved" signal). */
  wasStuck = false;
  /** Complexity-adaptive orientation length (extended when investigation fires). */
  effectiveOrientationTurns: number;
  /** Tools used during orientation — drives the one-shot investigation extension. */
  readonly orientationToolsUsed = new Set<string>();

  constructor(options: EscalationTierControllerOptions) {
    this.tier = options.startOnPlanner ? 1 : 0;
    this.orientationPhase = options.startOnPlanner;
    this.effectiveOrientationTurns = options.orientationPhaseTurns;
  }
}
