/**
 * Per-invocation state bags for the agent turn loop (RFC LP-16 Phase 3 — the
 * loop.ts landmine "driver-flip").
 *
 * `loop()` historically held ~30 raw local variables that its turn phases
 * read/write. To extract those phases as free `runXPhase(host, …)` functions the
 * state must live in objects the phases can be handed. This module provides the
 * two homes, scoped by lifetime:
 *
 *   - {@link LoopSession} — one instance per `loop()` invocation, holding the
 *     session-scoped counters that persist ACROSS turns (declared before the
 *     `while` today).
 *   - {@link TurnScope} — one instance per `while` iteration, holding the
 *     turn-scoped flags that reset EACH turn (declared inside the `while` today).
 *
 * Both are plain mutable data holders, not behavior classes: the phases own the
 * logic, these own the state. Reference-typed session collaborators (the `esc`
 * EscalationTierController, the `TurnState` collections, the blocked-action /
 * outcome arrays) stay as `loop()` locals and are threaded into phases directly,
 * exactly as the already-extracted phases receive them.
 */

/** Budget-urgency level tracked across turns for trace transitions. */
export type BudgetUrgencyLevel = "normal" | "low" | "critical";

/**
 * Session-scoped state: persists across turns within one `loop()` invocation.
 * Field defaults mirror the original in-`loop()` initializers exactly; the two
 * non-constant seeds (`tabId`, `lastActionMemoryPlanIndex`) are constructor args.
 */
export class LoopSession {
  /** Active tab the turn operates on (can change mid-run on navigation). */
  tabId: number;
  /** Element count carried into the next turn for empty-page retry. */
  prevElementCount = -1;
  /** Consecutive text-only (no tool-call) responses. */
  consecutiveTextOnly = 0;
  /** Total text-only responses this run. */
  totalTextOnly = 0;
  /** Summary captured when the task signals completion. */
  doneSummary = "";
  /** Last budget-urgency level, for trace transition events. */
  previousBudgetUrgencyLevel: BudgetUrgencyLevel = "normal";
  /** Circuit breaker: consecutive all-fail turns. */
  consecutiveAllFailTurns = 0;
  /** Circuit breaker: consecutive all-fail turns that were deterministic. */
  consecutiveAllFailDeterministicTurns = 0;
  /** Turns since the last step escalation (-1 = none active). */
  turnsSinceStepEscalation = -1;
  /** Consecutive exploration-only turns, for the exploration budget nudge. */
  consecutiveExplorationTurns = 0;
  /** tool_calls present but no reasoning content, consecutively. */
  consecutiveBlindToolTurns = 0;
  /** Last element id passed to read_element (repeat-read detection). */
  lastReadElementId: number | null = null;
  /** Consecutive read_element calls on the same element id. */
  consecutiveReadElementSameId = 0;
  /** Plan index the step-scoped action memory was last reset for. */
  lastActionMemoryPlanIndex: number;

  constructor(initialTabId: number, initialPlanIndex: number) {
    this.tabId = initialTabId;
    this.lastActionMemoryPlanIndex = initialPlanIndex;
  }
}

/**
 * Turn-scoped state: freshly constructed at the top of each `while` iteration.
 * Field defaults mirror the original in-loop `let` initializers.
 */
export class TurnScope {
  /** Whether the executor signalled task completion this turn. */
  doneSignaled = false;
  /** Whether a tool call modified the DOM this turn. */
  domModified = false;
  /** Whether a tool call visually modified the page this turn. */
  visuallyModified = false;
  /** Name of the last DOM-affecting tool invoked this turn. */
  lastDomAffectingToolName: string | null = null;
}
