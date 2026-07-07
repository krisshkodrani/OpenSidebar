/**
 * gates phase (RFC LP-15, Phase 11).
 *
 * The top-of-turn control gate: honor a pause, a graceful stop, and the policy
 * middleware's session-budget halt; advance the turn counters; and clear the
 * idempotency cache (unless a done() was just rejected). It is the phase that
 * exercises the `end_turn` result — the two break conditions (`!isRunning`,
 * middleware halt) stop the turn sequence and let the driver's while-loop settle
 * the run. Everything it touches is a real AgentLoop field/method, so loop()
 * passes `this` (the dispatch-host idiom); the one loop-local dependency
 * (resetStepScopedActionMemory, which closes over per-run accumulators) is
 * passed in.
 */

import type { CheckpointCoordinator } from "../checkpoint-coordinator";
import type { AgentTelemetryController } from "../agent-telemetry-controller";
import type { AgentMiddleware } from "../middleware";
import type { logger, SessionScopedLogger } from "../../../utils";
import { AgentStatus } from "../../../types";
import type { BroadcastMessage } from "../agent-broadcast";

export interface GatesPhaseHost {
  readonly isRunning: boolean;
  turnCount: number;
  turnsOnCurrentStep: number;
  guardAfterDoneRejection: boolean;
  readonly pauseGate: { promise: Promise<void>; resolve: () => void } | null;
  readonly checkpoints: CheckpointCoordinator;
  readonly middleware: AgentMiddleware;
  readonly maxTurns: number;
  readonly telemetry: AgentTelemetryController;
  readonly log: typeof logger | SessionScopedLogger;
  readonly workspaceId: string | null;
  readonly workerId: string | null;
  throwIfGracefulStopRequested(): void;
  finishStream(): void;
  broadcast(message: BroadcastMessage): void;
  statusHandler(status: AgentStatus, detail: string): void;
}

export type GatesPhaseResult = { kind: "continue" } | { kind: "end_turn" };

export async function runGatesPhase(
  host: GatesPhaseHost,
  deps: { resetStepScopedActionMemory: () => void },
): Promise<GatesPhaseResult> {
  // Pause gate — block here if the user paused the loop.
  if (host.pauseGate) await host.pauseGate.promise;
  host.throwIfGracefulStopRequested();
  if (!host.isRunning) {
    // Finalize the stream so the side panel exits isStreaming state.
    host.finishStream();
    return { kind: "end_turn" };
  }

  host.turnCount++;
  host.turnsOnCurrentStep++;
  deps.resetStepScopedActionMemory();

  // Clear the idempotency cache unless a done() was just rejected (prevents
  // re-executing actions that already succeeded). Normal turns clear it so
  // legitimate repeated clicks work.
  if (!host.guardAfterDoneRejection) {
    host.checkpoints.clearEphemeral();
  }
  host.guardAfterDoneRejection = false;

  if (
    host.middleware.shouldHaltTurn(
      host.turnCount,
      host.maxTurns,
      host.telemetry.sessionStartTime,
    )
  ) {
    const haltMessage =
      "Stopped by policy middleware due to session budget limits.";
    host.log.warn("policy", "Halting loop turn", {
      turn: host.turnCount,
      workspaceId: host.workspaceId,
      workerId: host.workerId,
    });
    host.broadcast({
      type: "STREAM_CHUNK",
      payload: { delta: haltMessage, done: false },
    });
    host.finishStream();
    host.statusHandler(AgentStatus.IDLE, "Stopped by middleware policy");
    return { kind: "end_turn" };
  }

  return { kind: "continue" };
}
