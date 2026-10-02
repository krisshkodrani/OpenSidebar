import {
  AgentStatus,
  type AgentStep,
  type SubtaskSummary,
  type ToolCall,
} from "../../../types";
import type { ContextManager } from "../context";
import type { CompletionEvidenceRuntime } from "../completion-evidence";
import type {
  CompletionEnvelope,
  TrustedCompletionCandidate,
} from "../completion-kernel";
import type { TraceRecorder } from "../trace";
import {
  successfulTaskCompletionMessage,
  type BroadcastMessage,
} from "../agent-broadcast";
import { annotateCompletedPlanSubtasksForAcceptedDone } from "../agent-plan-progress";
import { STRING_LIMITS } from "../constants";

export interface CompletedTaskResult {
  outcome: "completed";
  summary: string;
  completionEnvelope?: CompletionEnvelope;
}

export interface CompletionFinalizationHost {
  completedResult: CompletedTaskResult | null;
  readonly completionEvidenceRuntime: Pick<
    CompletionEvidenceRuntime,
    | "recordCompletionEvidence"
    | "createCompletionEnvelope"
    | "recordCompletionEnvelope"
  >;
  readonly traceRecorder: TraceRecorder | null;
  readonly turnCount: number;
  readonly context: Pick<
    ContextManager,
    "clearPlanStatus" | "getCurrentUrl" | "addMessage"
  >;
  readonly taskId: string | null;
  readonly planSubtasks: SubtaskSummary[];
  readonly taskStartTime: number;
  readonly urlHistory: string[];
  stepHandler(step: AgentStep, update: boolean): void;
  finishStream(summary: string): void;
  statusHandler(status: AgentStatus, detail: string): void;
  messageHandler(summary: string, toolCalls: ToolCall[]): void;
  saveTurnCheckpoint(): Promise<void>;
  logInfo(
    component: "agent",
    message: string,
    data: Record<string, unknown>,
  ): void;
  broadcast(message: BroadcastMessage): void;
  broadcastFinalMetrics(): void;
}

/** Apply accepted completion results to terminal state, trace, and UI. */
export class CompletionFinalizationRuntime {
  constructor(private readonly host: CompletionFinalizationHost) {}

  completeTaskUi(summary: string): void {
    this.host.stepHandler(
      {
        id: crypto.randomUUID(),
        type: "info",
        label: "Task complete",
        status: "done",
        timestamp: Date.now(),
      },
      false,
    );
    // Replace accumulated reasoning with clean summary and finalize the stream.
    // done:true is critical - without it the side panel message stays in
    // isStreaming state and the "Thinking..." placeholder hides the summary.
    this.host.finishStream(summary);
    this.host.statusHandler(AgentStatus.IDLE, "Done");
    this.host.messageHandler(summary, []);
  }

  completeTaskResult(
    summary: string,
    options: {
      saveCheckpoint?: boolean;
      completionCandidate?: TrustedCompletionCandidate;
    } = {},
  ): void {
    if (this.host.completedResult) {
      return;
    }
    let completionEnvelope: CompletionEnvelope | undefined;
    const candidate = options.completionCandidate;
    if (candidate) {
      this.host.completionEvidenceRuntime.recordCompletionEvidence(
        candidate.evidence,
        "trusted_tool",
      );
      this.host.traceRecorder?.recordEvent("completion_candidate", {
        turn: this.host.turnCount,
        source: "trusted_tool",
        contractKind: candidate.contractKind,
        confidence: "high",
      });
      completionEnvelope =
        this.host.completionEvidenceRuntime.createCompletionEnvelope({
          source: "trusted_tool",
          contractKind: candidate.contractKind,
          decisionReason: candidate.decisionReason,
          evidence: candidate.evidence,
          summary,
        });
      this.host.traceRecorder?.recordEvent("completion_decision", {
        turn: this.host.turnCount,
        status: "accepted",
        source: "trusted_tool",
        reason: candidate.decisionReason,
        contractKind: candidate.contractKind,
        resultId: completionEnvelope.resultId,
        evidenceKeys: completionEnvelope.evidenceKeys,
        completionEnvelope,
      });
      this.host.completionEvidenceRuntime.recordCompletionEnvelope(
        completionEnvelope,
      );
    }
    this.host.completedResult = {
      outcome: "completed",
      summary,
      ...(completionEnvelope ? { completionEnvelope } : {}),
    };
    this.host.traceRecorder?.recordEvent("completion_state_transition", {
      turn: this.host.turnCount,
      from: "working",
      to: "completed",
      source: candidate ? "trusted_tool" : "direct_completion",
      ...(completionEnvelope
        ? {
            resultId: completionEnvelope.resultId,
            contractKind: completionEnvelope.contractKind,
          }
        : {}),
    });
    this.host.statusHandler(AgentStatus.IDLE, "Done");
    this.host.messageHandler(summary, []);
    if (options.saveCheckpoint !== false) {
      this.host.saveTurnCheckpoint().catch(() => {});
    }
  }

  acceptDoneToolCall(
    summary: string,
    toolCallId: string,
    completionEnvelope: CompletionEnvelope,
  ): void {
    // Signal completion immediately - the orchestrator reads this after a lane
    // timeout to avoid retrying completed subtasks.
    this.host.completedResult = {
      outcome: "completed",
      summary,
      completionEnvelope,
    };
    this.host.completionEvidenceRuntime.recordCompletionEnvelope(
      completionEnvelope,
    );
    this.host.traceRecorder?.recordEvent("completion_state_transition", {
      turn: this.host.turnCount,
      from: "working",
      to: "completed",
      source: "model_done",
      resultId: completionEnvelope.resultId,
      contractKind: completionEnvelope.contractKind,
    });

    this.host.context.clearPlanStatus();
    this.host.logInfo("agent", "DONE called", {
      turn: this.host.turnCount,
      url: this.host.context.getCurrentUrl(),
      summary: summary.slice(0, STRING_LIMITS.SUMMARY_LOG),
    });
    this.host.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content: summary,
    });
    this.completeTaskUi(summary);

    if (this.host.taskId && this.host.planSubtasks.length > 0) {
      annotateCompletedPlanSubtasksForAcceptedDone({
        subtasks: this.host.planSubtasks,
        summary,
      });

      const completionMessage = successfulTaskCompletionMessage({
        taskId: this.host.taskId,
        subtasks: this.host.planSubtasks,
        turnCount: this.host.turnCount,
        totalTimeMs: Date.now() - this.host.taskStartTime,
        summary,
        urlHistory: this.host.urlHistory,
      });
      if (completionMessage) this.host.broadcast(completionMessage);
    }

    this.host.broadcastFinalMetrics();
  }
}
