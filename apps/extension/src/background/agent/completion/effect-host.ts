import type { ContextManager } from "../context";
import type { CompletionEvaluation } from "../completion-kernel";
import type { TraceRecorder } from "../trace";
import type { CompletionEffectHost } from "./apply-effects";

export interface CompletionEffectStateHost {
  doneRejections: number;
  lastContractRejectionKind: string | undefined;
  consecutiveSameKindRejections: number;
  lastCompletionRejection: CompletionEvaluation | null;
  lastCompletionRecoveryHint: string | null;
  guardAfterDoneRejection: boolean;
  readonly context: Pick<ContextManager, "addMessage">;
  readonly traceRecorder: Pick<TraceRecorder, "recordEvent"> | null;
  doneRejectionDiagnosticContent(params: {
    summary: string;
    primaryReason: string;
    fallbackInstruction: string;
  }): string;
  checkDoneRejectionEscalation(): void;
  forceGroundingRefresh(tabId: number, reason: string): Promise<void>;
  runDonePlanRejection(
    toolCallId: string,
    summary: string,
    rejectReason: string,
    effectiveCurrentIdx: number,
  ): void;
}

/** Map declarative effects to the loop's current state for one done() call. */
export function createCompletionEffectHost(
  host: CompletionEffectStateHost,
  toolCallId: string,
  tabId: number,
): CompletionEffectHost {
  return {
    incrementDoneRejections: () => {
      host.doneRejections++;
    },
    recordContractRejection: (kind) => {
      if (host.lastContractRejectionKind === kind) {
        host.consecutiveSameKindRejections++;
      } else {
        host.lastContractRejectionKind = kind;
        host.consecutiveSameKindRejections = 1;
      }
    },
    setLastCompletionRejection: (decision) => {
      host.lastCompletionRejection = decision;
    },
    setRecoveryHint: (hint) => {
      host.lastCompletionRecoveryHint = hint;
    },
    postContextMessage: (role, content) => {
      host.context.addMessage(
        role === "tool"
          ? { role: "tool", tool_call_id: toolCallId, content }
          : { role: "user", content },
      );
    },
    postRejectionDiagnostic: (summary, primaryReason, fallbackInstruction) => {
      host.context.addMessage({
        role: "tool",
        tool_call_id: toolCallId,
        content: host.doneRejectionDiagnosticContent({
          summary,
          primaryReason,
          fallbackInstruction,
        }),
      });
    },
    emitTrace: (event, data) => {
      host.traceRecorder?.recordEvent(event, data);
    },
    setGuardAfterDoneRejection: () => {
      host.guardAfterDoneRejection = true;
    },
    checkDoneRejectionEscalation: () => {
      host.checkDoneRejectionEscalation();
    },
    forceGroundingRefresh: async () => {
      await host.forceGroundingRefresh(tabId, "done_before_grounding_read");
    },
    runDonePlanRejection: (id, summary, rejectReason, idx) =>
      host.runDonePlanRejection(id, summary, rejectReason, idx),
  };
}
