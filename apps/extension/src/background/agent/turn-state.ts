/**
 * TurnState (RFC LP-15, Phase 6).
 *
 * Owns the run-scoped accumulator collections that the tool dispatchers and the
 * stagnation-adjacent policies read/mutate: same-tool failure counts, the
 * recent-success and recent-tool-call windows,
 * and the find_element-discovered tag IDs. The agent loop creates one per run
 * and hands the collections (by reference) to the dispatchers.
 *
 * Passive by design — no model/chrome deps. `escalationTier`/`orientationPhase`
 * are deliberately NOT here (they belong to the EscalationTierController).
 */

import type { ToolName } from "../../types";
import type { RecentAction } from "./loop-helpers";

export class TurnState {
  /** Circuit breaker: same-tool repeat failure counts. */
  readonly toolFailCounts = new Map<string, number>();
  /** Sliding window of recent successful tool calls (redundant-action nudge). */
  readonly recentSuccesses: RecentAction[] = [];
  /** All recent tool calls, so exact loops can be blocked even when they "succeed". */
  readonly recentToolCalls: Array<{ tool: ToolName; argsKey: string }> = [];
  /** Tag IDs discovered by find_element (valid for the next tool call). */
  readonly discoveredTagIds = new Set<number>();

  /** Clear the recent-success window (called at escalation boundaries). */
  resetRecentSuccesses(): void {
    this.recentSuccesses.length = 0;
  }

  /** Clear the step-scoped action memory (recent tool calls + successes). */
  resetStepScopedActionMemory(): void {
    this.recentToolCalls.length = 0;
    this.recentSuccesses.length = 0;
  }
}
