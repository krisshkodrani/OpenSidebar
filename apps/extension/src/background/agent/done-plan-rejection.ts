/**
 * done_plan_rejection policy (RFC LP-16 Phase 3, extending the LP-15 completion work).
 *
 * When done() is rejected against an active plan, decide between three verbatim
 * outcomes: (1) retry_step — the current step uses retry semantics, so nudge and
 * retry without counting a rejection; (2) auto-advance — a "Plan incomplete."
 * rejection on a non-final step that clears the three-layer verification gate
 * (sentiment, coherence, success-criteria, rate-limit) converts done() into a
 * step completion; (3) otherwise fall through to rejectDoneAfterPlanValidation.
 * Extracted verbatim from loop() via the dispatch-host idiom — every member is a
 * real AgentLoop field/method, so loop() passes `this`; behavior-preserving.
 */

import type { ContextManager } from "./context";
import type { TraceRecorder } from "./trace";
import type { logger, SessionScopedLogger } from "../../utils";
import type { PlanStep } from "./planner";
import type { SubtaskSummary } from "../../types";
import { assessDoneSummary, checkSummaryStepCoherence } from "./verification";
import { matchSuccessCriteria } from "./loop-helpers";
import {
  advanceCompletedSubtasks,
  type AgentLoopPlanProgressHost,
} from "./loop-plan-progress";

export interface DonePlanRejectionHost {
  readonly planSteps: PlanStep[];
  stepRetryCount: number;
  consecutiveAutoAdvances: number;
  readonly doneRejections: number;
  readonly turnCount: number;
  readonly planSubtasks: SubtaskSummary[];
  readonly context: ContextManager;
  readonly traceRecorder: TraceRecorder | null;
  readonly log: typeof logger | SessionScopedLogger;
  syncPlanStatus(
    currentIndex: number,
    traceEvent?: "step_advanced_by_done_rejection",
    traceData?: Record<string, unknown>,
  ): void;
  broadcastTaskProgress(currentIndex: number): void;
  rejectDoneAfterPlanValidation(
    toolCallId: string,
    summary: string,
    rejectReason: string,
    effectiveCurrentIdx: number,
  ): void;
}

export function runDonePlanRejection(
  host: DonePlanRejectionHost,
  toolCallId: string,
  summary: string,
  rejectReason: string,
  effectiveCurrentIdx: number,
): void {
    // retry_step: when the current step uses retry semantics
    // (infinite scroll, pagination), reject done() without
    // counting toward doneRejections — the executor should
    // keep trying the same step.
    const currentStep = host.planSteps[effectiveCurrentIdx];
    if (currentStep?.verifyAfter?.action === "retry_step") {
      const maxRetries = currentStep.verifyAfter.maxRetries ?? 8;
      if (host.stepRetryCount < maxRetries) {
        host.stepRetryCount++;
        host.context.addMessage({
          role: "tool",
          tool_call_id: toolCallId,
          content:
            `Step not yet complete (attempt ${host.stepRetryCount}/${maxRetries}). ` +
            `${currentStep.verifyAfter.trigger} not detected yet. ` +
            `Keep trying: scroll down further, wait for content to load, then check again.`,
        });
        host.log.info("agent", "retry_step: attempt", {
          turn: host.turnCount,
          step: effectiveCurrentIdx,
          attempt: host.stepRetryCount,
          maxRetries,
        });
        return;
      }
      // Exhausted retries — fall through to normal rejection
    }

    const planIncompleteOnly = rejectReason.startsWith("Plan incomplete.");
    const canAdvanceStep =
      planIncompleteOnly &&
      effectiveCurrentIdx >= 0 &&
      effectiveCurrentIdx < host.planSubtasks.length - 1;

    if (canAdvanceStep) {
      // Three-layer verification gate before auto-advance
      const sentiment = assessDoneSummary(summary);
      const criteriaCheck = matchSuccessCriteria({
        successCriteria: host.planSteps[effectiveCurrentIdx]?.successCriteria,
        snapshot: host.context.getSnapshot(),
      });
      const autoAdvanceCap = Math.max(
        2,
        Math.ceil(host.planSubtasks.length / 2),
      );
      const rateLimited = host.consecutiveAutoAdvances >= autoAdvanceCap;

      const coherence = checkSummaryStepCoherence({
        summary,
        currentStepIndex: effectiveCurrentIdx,
        stepDescriptions: host.planSubtasks.map((s) => s.description),
      });

      let gateBlockReason: string | null = null;
      if (!sentiment.confident) {
        gateBlockReason = `Summary admits failure: ${sentiment.reason}`;
      } else if (!coherence.coherent) {
        gateBlockReason = `Summary doesn't match current step: ${coherence.reason}`;
      } else if (!criteriaCheck.satisfied) {
        const evidenceParts = [
          `${criteriaCheck.matchedTokens.length}/${criteriaCheck.totalTokens} tokens matched`,
        ];
        if (criteriaCheck.requiredQuotedPhrases.length > 0) {
          evidenceParts.push(
            `${criteriaCheck.matchedQuotedPhrases.length}/${criteriaCheck.requiredQuotedPhrases.length} quoted phrases matched`,
          );
        }
        if (criteriaCheck.requiredNumbers.length > 0) {
          evidenceParts.push(
            `${criteriaCheck.matchedNumbers.length}/${criteriaCheck.requiredNumbers.length} numeric values matched`,
          );
        }
        gateBlockReason = `Success criteria not met (${evidenceParts.join(", ")})`;
      } else if (rateLimited) {
        gateBlockReason = `Rate limited: ${host.consecutiveAutoAdvances} consecutive auto-advances without DOM action`;
      }

      if (gateBlockReason) {
        // Gate blocked — fall through to rejection path below
        host.log.warn("agent", "Auto-advance blocked by verification gate", {
          turn: host.turnCount,
          step: effectiveCurrentIdx,
          reason: gateBlockReason,
          sentiment: sentiment.confident,
          criteriaMatched: criteriaCheck.matchedTokens,
          criteriaTotal: criteriaCheck.totalTokens,
          quotedMatched: criteriaCheck.matchedQuotedPhrases,
          quotedTotal: criteriaCheck.requiredQuotedPhrases,
          numbersMatched: criteriaCheck.matchedNumbers,
          numbersTotal: criteriaCheck.requiredNumbers,
          consecutiveAutoAdvances: host.consecutiveAutoAdvances,
        });
        host.traceRecorder?.recordEvent("auto_advance_blocked", {
          step: effectiveCurrentIdx,
          reason: gateBlockReason,
          summary: summary.slice(0, 200),
        });
        // Fall through to doneRejections++ below
      } else {
        // Gate passed — proceed with auto-advance
        host.consecutiveAutoAdvances++;
        const previousIdx = effectiveCurrentIdx;
        const newIdx = advanceCompletedSubtasks(
          host as unknown as AgentLoopPlanProgressHost,
        );
        const completedStep =
          host.planSubtasks[previousIdx]?.description ||
          `Step ${previousIdx + 1}`;
        const nextStep =
          host.planSubtasks[newIdx]?.description || "Finish the remaining plan";

        host.syncPlanStatus(newIdx, "step_advanced_by_done_rejection", {
          rejections: host.doneRejections,
          advancedTo: newIdx,
          convertedFromDone: true,
        });
        host.broadcastTaskProgress(newIdx);
        host.log.info("agent", "DONE converted into step completion", {
          turn: host.turnCount,
          completedStep: completedStep.slice(0, 200),
          nextStep: nextStep.slice(0, 200),
        });
        host.context.addMessage({
          role: "tool",
          tool_call_id: toolCallId,
          content:
            `Step ${previousIdx + 1} verified complete.\n\n` +
            `Now active: Step ${newIdx + 1} — ${nextStep}.\n` +
            "Observe the page with read_page first, then act. Do NOT call done() until this step is completed and verified.",
        });
        return;
      }
    }

    host.rejectDoneAfterPlanValidation(
      toolCallId,
      summary,
      rejectReason,
      effectiveCurrentIdx,
    );
}
