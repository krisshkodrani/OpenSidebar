import type { PartialProgressHandoff, SessionMetrics } from "../../types";
import { AgentStatus } from "../../types";
import type { logger, SessionScopedLogger } from "../../utils";
import type { BroadcastMessage } from "./agent-broadcast";
import type { CompletionEnvelope, TrustedCompletionCandidate } from "./completion-kernel";
import type { LoopResult } from "./loop-types";
import type { LoopSession, TurnScope } from "./loop-scope";
import { formatPartialProgressHandoffSummary } from "./partial-progress-handoff";
import type { TraceRecorder } from "./trace";

export function createCompletionSignal(
  session: LoopSession,
  turn: TurnScope,
  completeTaskResult: (
    summary: string,
    options?: {
      saveCheckpoint?: boolean;
      completionCandidate?: TrustedCompletionCandidate;
    },
  ) => void,
) {
  return (
    summary: string,
    options?: {
      saveCheckpoint?: boolean;
      completionCandidate?: TrustedCompletionCandidate;
    },
  ) => {
    session.doneSummary = summary;
    turn.doneSignaled = true;
    completeTaskResult(summary, options);
  };
}

export function finishLoopSession(input: {
  turnCount: number;
  maxTurns: number;
  doneSummary: string;
  completedResult: { completionEnvelope?: CompletionEnvelope } | null;
  log: typeof logger | SessionScopedLogger;
  traceRecorder: TraceRecorder | null;
  buildPartialHandoff: () => PartialProgressHandoff;
  broadcast: (message: BroadcastMessage) => void;
  finishStream: () => void;
  statusHandler: (status: AgentStatus, detail: string) => void;
  getMetrics: () => SessionMetrics;
}): LoopResult {
  if (input.turnCount >= input.maxTurns && !input.completedResult) {
    input.log.warn("agent", "Loop ended: max turns reached", {
      turns: input.turnCount,
      maxTurns: input.maxTurns,
    });
    const partialHandoff = input.buildPartialHandoff();
    input.traceRecorder?.recordEvent("partial_handoff_created", {
      reason: partialHandoff.reason,
      turnsUsed: partialHandoff.turnsUsed,
      maxTurns: partialHandoff.maxTurns,
      completedCount: partialHandoff.completed.length,
      evidenceCount: partialHandoff.evidence.length,
      remainingCount: partialHandoff.remaining.length,
      handoff: partialHandoff,
    });
    const limitMsg = formatPartialProgressHandoffSummary(partialHandoff);
    input.broadcast({
      type: "STREAM_CHUNK",
      payload: { delta: "", done: false, replaceContent: limitMsg },
    });
    input.finishStream();
    input.statusHandler(
      AgentStatus.IDLE,
      `Turn limit (${input.turnCount}/${input.maxTurns})`,
    );
    return {
      outcome: "max_turns" as const,
      turnCount: input.turnCount,
      summary: limitMsg,
      failure: {
        category: "budget",
        code: "turn_limit_reached",
        detail: limitMsg,
      },
      metrics: input.getMetrics(),
      partialHandoff,
    };
  }

  return {
    outcome: "completed" as const,
    turnCount: input.turnCount,
    summary: input.doneSummary,
    failure: { category: "none", code: "none" },
    metrics: input.getMetrics(),
    completionEnvelope: input.completedResult?.completionEnvelope,
  };
}
