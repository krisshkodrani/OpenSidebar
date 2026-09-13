/**
 * Turn state machine (RFC LP-15, Phase 11).
 *
 * The agent loop's single 2,580-line `loop()` iteration is being decomposed into
 * an ordered sequence of named phases. This module defines the *vocabulary* that
 * decomposition speaks — the phase ids, their canonical order, what one phase
 * returns, and the shared `TurnContext` — so phases can be extracted from
 * `loop()` one at a time, each behind its own test, without a big-bang rewrite.
 *
 * `TurnContext` is deliberately NOT a god host: it exposes the handful of stable
 * per-turn collaborators that already exist as instances (state, escalation,
 * telemetry, checkpoints, perception). A phase that needs more takes a narrow
 * per-phase context alongside it — never a ~40-member `any` surface.
 */

import type { TurnState } from "./turn-state";
import type { EscalationTierController } from "./escalation-tier-controller";
import type { AgentTelemetryController } from "./agent-telemetry-controller";
import type { CheckpointCoordinator } from "./checkpoint-coordinator";
import type { PageStateCoordinator } from "./page-state";
import type { LoopResult } from "./loop-types";

/**
 * The named phases of one turn, in the order `loop()` executes them. This order
 * is the measured per-iteration sequence of the real loop; the pinning test
 * guards the invariant that `account_and_refresh` runs strictly after
 * `completion` (accounting must see the settled completion state).
 */
export type TurnPhaseId =
  | "gates"
  | "escalation"
  | "feedback"
  | "prepare_model_turn"
  | "dispatch_tools"
  | "post_tool_guards"
  | "plan_monitor"
  | "completion"
  | "account_and_refresh";

/** The canonical per-iteration phase order (matches `loop()` execution). */
export const TURN_PHASE_ORDER: readonly TurnPhaseId[] = [
  "gates",
  "escalation",
  "feedback",
  "prepare_model_turn",
  "dispatch_tools",
  "post_tool_guards",
  "plan_monitor",
  "completion",
  "account_and_refresh",
];

/**
 * What a phase tells the driver to do next:
 *   - `continue`  → advance to the next phase (optionally carrying a value);
 *   - `skip_to`   → jump to a later phase this turn (skip the ones between);
 *   - `next_turn` → abandon the remaining phases and start the next while
 *                   iteration immediately (maps to today's `continue`);
 *   - `end_turn`  → stop this turn's phase sequence; the while-loop decides
 *                   whether to start another turn (maps to today's `break`);
 *   - `end_task`  → terminate the whole loop with a LoopResult (today's `return`).
 */
export type TurnPhaseResult<T = void> =
  | { kind: "continue"; value?: T }
  | { kind: "skip_to"; phase: TurnPhaseId }
  | { kind: "next_turn" }
  | { kind: "end_turn" }
  | { kind: "end_task"; result: LoopResult };

/** One extracted phase: a named unit that advances the turn given its context. */
export interface TurnPhase<Ctx, T = void> {
  readonly id: TurnPhaseId;
  run(ctx: Ctx): Promise<TurnPhaseResult<T>> | TurnPhaseResult<T>;
}

/**
 * The stable per-turn collaborators shared across phases. Each already exists as
 * an instance on `AgentLoop` (Phases 6–10); a phase narrows to exactly what it
 * needs by taking `TurnContext & { …phase-specific deps }`.
 */
export interface TurnContext {
  readonly state: TurnState;
  readonly escalation: EscalationTierController;
  readonly telemetry: AgentTelemetryController;
  readonly checkpoints: CheckpointCoordinator;
  readonly perception: PageStateCoordinator;
}

/** Narrow helpers for the driver. */
export function isTerminalResult(
  result: TurnPhaseResult<unknown>,
): result is { kind: "end_turn" } | { kind: "end_task"; result: LoopResult } {
  return result.kind === "end_turn" || result.kind === "end_task";
}
