/**
 * Escalation rescue policy (RFC LP-2 "Converge or Escalate").
 *
 * Complements the snapshot-delta stuck monitors (fingerprint stagnation,
 * step watchdog, same-URL) with progress-based triggers that catch the
 * "moving page, frozen progress" failure mode they cannot see, plus an
 * efficacy guard that fails the run fast when an escalation does not
 * rescue it.
 *
 * Verified progress means structural evidence that the run moved forward:
 * a plan step advanced, a mutation-sensitive action executed successfully,
 * trusted tool evidence accumulated, or a never-before-seen URL was
 * reached. Raw DOM churn deliberately does not count — a flailing agent
 * changes the page constantly without making any of these signals move.
 */
import { ESCALATION_RESCUE } from "./constants";

export type VerifiedProgressKind =
  | "plan_step_advance"
  | "mutation"
  | "trusted_evidence"
  | "new_url";

/** Where an escalation came from, for unified fire-rate telemetry. */
export type EscalationRescueSource =
  | "no_progress"
  | "budget_stall"
  | "step_watchdog"
  | "same_url"
  | "done_rejection"
  | "voluntary";

export type EscalationOutcomeKind =
  | "rescued"
  | "failed_fast"
  | "budget_exhausted";

export interface EscalationRescueTraceEvent {
  type: "escalation_triggered" | "escalation_outcome";
  data: Record<string, unknown>;
}

export interface EscalationRescueAssessmentInput {
  /** Current turn (already incremented for this iteration). */
  turn: number;
  maxTurns: number;
  /** 0 = executor tier, 1 = planner tier. */
  escalationTier: number;
  /** De-escalation cooldown turns remaining. */
  cooldownRemaining: number;
  planSubtaskCount: number;
  planCompletedCount: number;
}

export type EscalationRescueAssessment =
  | { kind: "none" }
  | {
      kind: "escalate";
      trigger: "no_progress" | "budget_stall";
      reason: string;
    }
  | { kind: "fail_fast"; reason: string };

export class EscalationRescueTracker {
  private lastVerifiedProgressTurn = 0;
  private lastVerifiedProgressKind: VerifiedProgressKind | null = null;
  private escalationActiveSinceTurn: number | null = null;
  private escalationSource: EscalationRescueSource | null = null;
  private rescueTriggerUsed = false;
  private failFastFired = false;
  private pendingEvents: EscalationRescueTraceEvent[] = [];

  reset(): void {
    this.lastVerifiedProgressTurn = 0;
    this.lastVerifiedProgressKind = null;
    this.escalationActiveSinceTurn = null;
    this.escalationSource = null;
    this.rescueTriggerUsed = false;
    this.failFastFired = false;
    this.pendingEvents = [];
  }

  /**
   * Record a verified-progress signal. Closes any active efficacy window as
   * "rescued" — call order is chronological, so progress recorded after an
   * escalation in the same turn counts as a rescue, while progress that
   * preceded the escalation does not (the window opens after it).
   */
  recordVerifiedProgress(turn: number, kind: VerifiedProgressKind): void {
    this.lastVerifiedProgressTurn = Math.max(
      this.lastVerifiedProgressTurn,
      turn,
    );
    this.lastVerifiedProgressKind = kind;
    if (this.escalationActiveSinceTurn !== null) {
      this.pendingEvents.push({
        type: "escalation_outcome",
        data: {
          outcome: "rescued" satisfies EscalationOutcomeKind,
          trigger: this.escalationSource,
          escalatedAtTurn: this.escalationActiveSinceTurn,
          resolvedAtTurn: turn,
          progressKind: kind,
        },
      });
      this.escalationActiveSinceTurn = null;
      this.escalationSource = null;
    }
  }

  /**
   * Record that an escalation (replan or tier swap) fired. Opens the efficacy
   * window unless one is already active — overlapping escalations share the
   * original window so cascading triggers cannot extend a dead run.
   */
  noteEscalation(turn: number, source: EscalationRescueSource): void {
    this.pendingEvents.push({
      type: "escalation_triggered",
      data: {
        trigger: source,
        turn,
        lastVerifiedProgressTurn: this.lastVerifiedProgressTurn,
        turnsSinceVerifiedProgress: turn - this.lastVerifiedProgressTurn,
      },
    });
    if (this.escalationActiveSinceTurn === null) {
      this.escalationActiveSinceTurn = turn;
      this.escalationSource = source;
    }
  }

  /**
   * User feedback mid-run restarts both clocks: the user redirected the
   * agent, so neither the no-progress trigger nor the efficacy window should
   * count turns that preceded the new instruction.
   */
  noteUserIntervention(turn: number): void {
    this.lastVerifiedProgressTurn = Math.max(
      this.lastVerifiedProgressTurn,
      turn,
    );
    if (this.escalationActiveSinceTurn !== null) {
      this.escalationActiveSinceTurn = turn;
    }
  }

  /**
   * Per-turn assessment. Order matters: the efficacy guard is checked first
   * so a failed escalation ends the run before any further trigger fires.
   */
  assess(input: EscalationRescueAssessmentInput): EscalationRescueAssessment {
    if (this.failFastFired) return { kind: "none" };

    if (
      this.escalationActiveSinceTurn !== null &&
      input.turn - this.escalationActiveSinceTurn >=
        ESCALATION_RESCUE.EFFICACY_TURNS
    ) {
      this.failFastFired = true;
      const reason =
        `Escalation at turn ${this.escalationActiveSinceTurn} ` +
        `(${this.escalationSource}) produced no verified progress within ` +
        `${ESCALATION_RESCUE.EFFICACY_TURNS} turns.`;
      this.pendingEvents.push({
        type: "escalation_outcome",
        data: {
          outcome: "failed_fast" satisfies EscalationOutcomeKind,
          trigger: this.escalationSource,
          escalatedAtTurn: this.escalationActiveSinceTurn,
          resolvedAtTurn: input.turn,
          lastVerifiedProgressTurn: this.lastVerifiedProgressTurn,
        },
      });
      this.escalationActiveSinceTurn = null;
      this.escalationSource = null;
      return { kind: "fail_fast", reason };
    }

    if (
      this.rescueTriggerUsed ||
      this.escalationActiveSinceTurn !== null ||
      input.escalationTier >= 1 ||
      input.cooldownRemaining > 0
    ) {
      return { kind: "none" };
    }

    const turnsSinceProgress = input.turn - this.lastVerifiedProgressTurn;

    // No-plan runs only: planned runs are covered by the step watchdog, which
    // tracks turns-on-step with its own defer/warn ramp.
    if (
      input.planSubtaskCount === 0 &&
      turnsSinceProgress >= ESCALATION_RESCUE.NO_PROGRESS_TURNS
    ) {
      this.rescueTriggerUsed = true;
      return {
        kind: "escalate",
        trigger: "no_progress",
        reason:
          `no verified progress (plan advance, successful mutation, trusted ` +
          `evidence, or new page) for ${turnsSinceProgress} turns`,
      };
    }

    // Multi-step plans only: half the budget gone with less than half the
    // plan complete means the current approach will not converge in budget.
    if (
      input.planSubtaskCount >= 2 &&
      input.turn >=
        Math.ceil(
          input.maxTurns * ESCALATION_RESCUE.BUDGET_STALL_TURN_FRACTION,
        ) &&
      input.planCompletedCount / input.planSubtaskCount <
        ESCALATION_RESCUE.BUDGET_STALL_PLAN_FRACTION
    ) {
      this.rescueTriggerUsed = true;
      return {
        kind: "escalate",
        trigger: "budget_stall",
        reason:
          `${input.turn}/${input.maxTurns} turns used but only ` +
          `${input.planCompletedCount}/${input.planSubtaskCount} plan steps ` +
          `complete`,
      };
    }

    return { kind: "none" };
  }

  /**
   * Resolve a still-open efficacy window at loop end. A completed run was
   * rescued by definition; a max-turns run exhausted its budget without the
   * escalation paying off.
   */
  onLoopEnd(turn: number, outcome: "completed" | "max_turns" | "other"): void {
    if (this.escalationActiveSinceTurn === null) return;
    if (outcome === "other") return;
    this.pendingEvents.push({
      type: "escalation_outcome",
      data: {
        outcome: (outcome === "completed"
          ? "rescued"
          : "budget_exhausted") satisfies EscalationOutcomeKind,
        trigger: this.escalationSource,
        escalatedAtTurn: this.escalationActiveSinceTurn,
        resolvedAtTurn: turn,
        resolvedBy: outcome,
      },
    });
    this.escalationActiveSinceTurn = null;
    this.escalationSource = null;
  }

  /** Drain queued trace events; the loop forwards them to the TraceRecorder. */
  drainEvents(): EscalationRescueTraceEvent[] {
    const out = this.pendingEvents;
    this.pendingEvents = [];
    return out;
  }

  get hasFailedFast(): boolean {
    return this.failFastFired;
  }
}
