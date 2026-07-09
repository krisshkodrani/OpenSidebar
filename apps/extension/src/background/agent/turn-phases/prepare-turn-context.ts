/**
 * prepare_turn_context phase (RFC LP-16 Phase 3b — loop.ts landmine
 * decomposition).
 *
 * The pre-inference turn bookkeeping that runs after the feedback phase and
 * before escalation: throttled turn-progress broadcast, the turn-budget time
 * context, budget-urgency trace transitions, the money-table aggregate refresh,
 * and the catalog-order snapshot completion check (which can complete the run).
 * Extracted verbatim from loop() via the dispatch-host idiom.
 *
 *   - `end_task`  → the catalog-order confirmation page completed the run;
 *   - `continue`  → proceed to the escalation phase.
 */

import type { TraceRecorder } from "../trace";
import type { LoopResult } from "../loop-types";
import type { LoopSession } from "../loop-scope";
import { BROADCAST_INTERVALS } from "../constants";

export interface PrepareTurnContextHost {
  readonly turnCount: number;
  readonly maxTurns: number;
  readonly traceRecorder: TraceRecorder | null;
  readonly llm: { getActiveProviderInfo(): { providerId: string } };
  readonly context: {
    setTimeContext(turn: number, maxTurns: number, sessionStart: number): void;
    getBudgetUrgencyLevel(): "normal" | "low" | "critical";
  };
  readonly telemetry: { readonly sessionStartTime: number };
  broadcast(message: unknown): void;
  updateMoneyTableAggregateFromSnapshot(): void;
  maybeCompleteCatalogOrderFromSnapshot(): LoopResult | null;
}

export type PrepareTurnContextResult =
  | { kind: "continue" }
  | { kind: "end_task"; result: LoopResult };

export function runPrepareTurnContextPhase(
  host: PrepareTurnContextHost,
  session: LoopSession,
): PrepareTurnContextResult {
  // Broadcast turn progress to side panel (throttled)
  if (
    host.turnCount === 1 ||
    host.turnCount % BROADCAST_INTERVALS.TURN_PROGRESS === 0
  ) {
    host.broadcast({
      type: "AGENT_TURN",
      payload: {
        turn: host.turnCount,
        maxTurns: host.maxTurns,
        provider: host.llm.getActiveProviderInfo().providerId,
      },
    });
  }

  // Set time context for turn budget indicator
  host.context.setTimeContext(
    host.turnCount,
    host.maxTurns,
    host.telemetry.sessionStartTime,
  );
  // Emit trace events on budget urgency level transitions
  {
    const currentBudgetLevel = host.context.getBudgetUrgencyLevel();
    if (currentBudgetLevel !== session.previousBudgetUrgencyLevel) {
      if (currentBudgetLevel === "critical") {
        host.traceRecorder?.recordEvent("budget_critical", {
          turnCount: host.turnCount,
          maxTurns: host.maxTurns,
          remaining: Math.max(0, host.maxTurns - host.turnCount),
        });
      } else if (currentBudgetLevel === "low") {
        host.traceRecorder?.recordEvent("budget_warning", {
          turnCount: host.turnCount,
          maxTurns: host.maxTurns,
          remaining: Math.max(0, host.maxTurns - host.turnCount),
        });
      }
      session.previousBudgetUrgencyLevel = currentBudgetLevel;
    }
  }
  host.updateMoneyTableAggregateFromSnapshot();
  const catalogSnapshotCompletion =
    host.maybeCompleteCatalogOrderFromSnapshot();
  if (catalogSnapshotCompletion) {
    return { kind: "end_task", result: catalogSnapshotCompletion };
  }
  return { kind: "continue" };
}
