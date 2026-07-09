/**
 * account_and_refresh phase (RFC LP-16 Phase 3, extending the LP-15 Phase 11
 * turn machine).
 *
 * End-of-turn bookkeeping for the tool-call path: the rolling history
 * distillation cadence, then the durable turn checkpoint + trace turn-flush.
 * When the turn signalled completion it awaits the checkpoint and reports
 * `end_turn` (the loop breaks to the terminal result block); otherwise it
 * fire-and-forgets the checkpoint and continues. By the turn-machine pinning
 * invariant this runs strictly AFTER the completion phase. Everything it touches
 * is a real AgentLoop field/method, so loop() passes `this` (the dispatch-host
 * idiom).
 */

import type { ContextManager } from "../context";
import type { TraceRecorder } from "../trace";
import { ROLLING_DISTILL } from "../constants";

export interface AccountAndRefreshHost {
  readonly turnCount: number;
  readonly context: ContextManager;
  readonly traceRecorder: TraceRecorder | null;
  saveTurnCheckpoint(): Promise<void>;
}

export type AccountAndRefreshResult =
  | { kind: "continue" }
  | { kind: "end_turn" };

export async function runAccountAndRefreshPhase(
  host: AccountAndRefreshHost,
  turn: { readonly doneSignaled: boolean },
): Promise<AccountAndRefreshResult> {
  // S1: Rolling distillation — periodically compress older history.
  if (
    host.turnCount > 0 &&
    host.turnCount % ROLLING_DISTILL.INTERVAL === 0 &&
    host.context.getMessages().length >= ROLLING_DISTILL.MIN_MESSAGES
  ) {
    host.context.rollingDistill(
      ROLLING_DISTILL.KEEP_RECENT,
      ROLLING_DISTILL.MAX_SUMMARY_ENTRIES,
    );
  }

  if (turn.doneSignaled) {
    // Durable checkpoint: persist loop state for SW restart recovery.
    await host.saveTurnCheckpoint();
    await host.traceRecorder?.endTurn();
    return { kind: "end_turn" };
  }

  // Durable checkpoint: persist loop state for SW restart recovery.
  host.saveTurnCheckpoint().catch(() => {});
  // Trace: flush turn at end of each iteration.
  await host.traceRecorder?.endTurn();
  return { kind: "continue" };
}
