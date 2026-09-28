import type { BlockedAction, RecentOutcome, SubgoalAttempt } from "./loop-helpers";
import { LoopSession } from "./loop-scope";
import { TurnState } from "./turn-state";
import { createTurnController, type TurnControllerHost } from "./turn-controller";

/** Per-run state shared by the turn phases and escalation controller. */
export function createLoopRunState(
  host: TurnControllerHost,
  initialTabId: number,
  lastPlanIndex: number,
) {
  const session = new LoopSession(initialTabId, lastPlanIndex);
  const turnState = new TurnState();
  const { toolFailCounts, recentSuccesses, recentToolCalls } = turnState;
  const verifiedFinalClickBypassKeys = new Set<string>();
  const blockedActions: BlockedAction[] = [];
  const recentOutcomes: RecentOutcome[] = [];
  const recentObservationProgressKeys: string[] = [];
  const subgoalAttempts: SubgoalAttempt[] = [];
  const controller = createTurnController(host, session, {
    recentToolCalls,
    recentSuccesses,
    blockedActions,
    verifiedFinalClickBypassKeys,
    subgoalAttempts,
    recentOutcomes,
  });

  return {
    session,
    turnState,
    toolFailCounts,
    recentSuccesses,
    recentToolCalls,
    verifiedFinalClickBypassKeys,
    blockedActions,
    recentOutcomes,
    recentObservationProgressKeys,
    subgoalAttempts,
    ...controller,
  };
}
