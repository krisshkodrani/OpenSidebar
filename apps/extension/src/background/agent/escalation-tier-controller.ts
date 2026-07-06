/**
 * EscalationTierController (RFC LP-15, Phase 6).
 *
 * Owns the state AND the cohesive transition policies of the two-tier
 * (0=executor / 1=planner) escalation machine that previously lived as ~10
 * interdependent locals threaded through `AgentLoop.loop()`.
 *
 * Phase 6 migrated the state here first, then moves the self-contained policies
 * in as methods. `onTurnStart()` (the per-turn cooldown tick, one-shot
 * investigation extension, and plan-then-act orientation handoff) is the first —
 * it touches only controller state plus a few clean host callbacks. The escalation
 * ENTRY is single-sourced by `beginPlannerEscalation()` in the loop. The
 * progress-gated de-escalation and fresh-start blocks stay inline for now because
 * they also coordinate loop-owned working memory (broadcasts, stagnation, the
 * distillation/working-memory resets) that is not controller state.
 *
 * Host callbacks are injected getter-closures (the AgentTelemetryController /
 * CheckpointCoordinator pattern) so the controller stays free of chrome.* and
 * LLM deps. NOT absorbed: `EscalationRescueTracker` (escalation-rescue-policy.ts)
 * is a separate, already-clean system the loop calls into directly.
 */

import {
  ESCALATION_LIMITS,
  INVESTIGATION_EXTENSION,
  MAX_ORIENTATION_TURNS,
  ORIENTATION,
} from "./constants";
import type { RuntimeLimits } from "./constants";

/** Host surface the controller calls back into (no chrome or LLM types leak in). */
export interface EscalationTierControllerHost {
  /** Live runtime limits (escalationCooldown, etc.); read at call time. */
  readonly limits: RuntimeLimits;
  /** Current turn index (`AgentLoop.turnCount`). */
  getTurn(): number;
  /** De-escalate the model tier; returns the updated prevElementCount. */
  deescalateModel(tabId: number, prevElementCount: number): Promise<number>;
  /** Compose + inject the plan-then-act handoff reflection message. */
  addHandoffMessage(): void;
  /** Emit a "done" info step with the given label. */
  emitInfoStep(label: string): void;
  /** Structured info log under the "agent" channel. */
  logInfo(message: string, data: Record<string, unknown>): void;
  /** Whether the stagnation tracker still considers the page stuck. */
  isStillStuck(): boolean;
  /** Broadcast the "progress resolved" stagnation signal for the given URL. */
  broadcastProgressResolved(url: string): void;
  /** Inject the de-escalation reflection message. */
  addDeescalationMessage(): void;
  /** Reset the stagnation monitor's escalation state. */
  resetStagnationEscalation(): void;
}

export interface EscalationTierControllerOptions {
  /**
   * Start on the planner tier for the plan-then-act orientation phase. False
   * when the orchestrator requests `preferredModelTier="executor"` (skip
   * orientation entirely).
   */
  startOnPlanner: boolean;
  /** Baseline orientation length (`ORIENTATION.PHASE_TURNS`). */
  orientationPhaseTurns: number;
  /** Injected host callbacks. */
  host: EscalationTierControllerHost;
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

  private readonly host: EscalationTierControllerHost;

  constructor(options: EscalationTierControllerOptions) {
    this.tier = options.startOnPlanner ? 1 : 0;
    this.orientationPhase = options.startOnPlanner;
    this.effectiveOrientationTurns = options.orientationPhaseTurns;
    this.host = options.host;
  }

  /**
   * Per-turn escalation bookkeeping, run at the top of each loop turn:
   *   1. decrement the de-escalation cooldown;
   *   2. one-shot: extend orientation when the planner used investigation tools;
   *   3. plan-then-act handoff: once orientation is done, hand tier 1→0.
   * Returns the (possibly updated by de-escalation) prevElementCount.
   */
  async onTurnStart(params: {
    tabId: number;
    prevElementCount: number;
  }): Promise<number> {
    const host = this.host;
    let prevElementCount = params.prevElementCount;

    // 1. Decrement de-escalation cooldown.
    if (this.cooldownRemaining > 0) this.cooldownRemaining--;

    // 2. Complexity-adaptive: extend orientation when investigation tools are used.
    if (
      this.orientationPhase &&
      this.tier === 1 &&
      this.orientationToolsUsed.size > 0 &&
      this.effectiveOrientationTurns === ORIENTATION.PHASE_TURNS
    ) {
      this.effectiveOrientationTurns = Math.min(
        ORIENTATION.PHASE_TURNS + INVESTIGATION_EXTENSION,
        MAX_ORIENTATION_TURNS,
      );
      host.logInfo("Investigation detected, extending orientation", {
        turn: host.getTurn(),
        tools: [...this.orientationToolsUsed],
        effectiveOrientationTurns: this.effectiveOrientationTurns,
      });
    }

    // 3. plan-then-act handoff: planner model has oriented, hand off to executor.
    if (
      this.orientationPhase &&
      host.getTurn() > this.effectiveOrientationTurns &&
      this.tier === 1
    ) {
      this.orientationPhase = false;
      prevElementCount = await host.deescalateModel(
        params.tabId,
        prevElementCount,
      );
      this.tier = 0;
      this.cooldownRemaining = host.limits.escalationCooldown;
      host.addHandoffMessage();
      host.emitInfoStep("Handing off to executor model");
      host.logInfo("plan-then-act handoff", {
        turn: host.getTurn(),
        orientationTurns: this.effectiveOrientationTurns,
      });
    }

    return prevElementCount;
  }

  /**
   * Progress-gated de-escalation, run when the stagnation tracker reports no
   * new stuck signal this turn. Accumulates progress signals while stuck, and
   * once `PROGRESS_GATE` consecutive signals land, clears the stuck flag and —
   * if on the planner tier, under the cycle cap, and past minimum planner
   * tenure — de-escalates tier 1→0 with exponential cooldown backoff. When not
   * stuck at all, just resets the progress gate. Returns the (possibly
   * de-escalated) prevElementCount.
   */
  async recordProgressSignal(params: {
    snapUrl: string;
    tabId: number;
    prevElementCount: number;
  }): Promise<number> {
    const host = this.host;
    let prevElementCount = params.prevElementCount;

    if (!this.wasStuck) {
      // Not stuck — reset progress gate.
      this.consecutiveProgressSignals = 0;
      return prevElementCount;
    }

    // Only count as recovery if the page actually changed (tracker no longer
    // reports stuck). When still stuck, reset the gate.
    if (host.isStillStuck()) {
      this.consecutiveProgressSignals = 0;
    } else {
      this.consecutiveProgressSignals++;
    }

    // Require PROGRESS_GATE consecutive progress signals before de-escalating.
    if (this.consecutiveProgressSignals >= ESCALATION_LIMITS.PROGRESS_GATE) {
      host.broadcastProgressResolved(params.snapUrl);
      this.wasStuck = false;
      this.consecutiveProgressSignals = 0;

      // De-escalate if on planner model, under cycle limit, and the planner
      // model has had enough turns to actually work.
      const plannerTenure = host.getTurn() - this.plannerModelStartTurn;
      if (
        this.tier > 0 &&
        this.escalationCycles < host.limits.maxEscalationCycles &&
        plannerTenure >= ESCALATION_LIMITS.MIN_PLANNER_TENURE
      ) {
        prevElementCount = await host.deescalateModel(
          params.tabId,
          prevElementCount,
        );
        host.addDeescalationMessage();
        this.tier = 0;
        this.cooldownRemaining =
          host.limits.escalationCooldown * Math.pow(2, this.escalationCycles);
        this.escalationCycles++;
        host.resetStagnationEscalation();
        host.emitInfoStep("Progress made — switching back to executor model");
      }
    }

    return prevElementCount;
  }
}
