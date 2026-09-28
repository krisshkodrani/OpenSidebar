import type { DomSnapshot, SubtaskSummary } from "../../../types";
import type { ContextManager } from "../context";
import type { PlanStep } from "../planner";
import type { CompletionEvidenceLedger } from "../completion-kernel";
import type { CompletionEvidenceRuntime } from "../completion-evidence";
import type { MoneyTableRuntime } from "../loop-money-table";
import { countVisibleListDetailActions } from "../list-detail-policy";
import {
  computeSnapshotDigest,
  projectKernelEvidence,
  type CompletionDecisionRecordInput,
} from "./decision-record";
import type { CompletionGuardContext } from "./guards/context";

export interface CompletionDecisionContextHost {
  readonly context: Pick<ContextManager, "getSnapshot">;
  readonly completionEvidenceRuntime: Pick<
    CompletionEvidenceRuntime,
    "getActiveCompletionContext"
  >;
  readonly completionEvidence: Pick<CompletionEvidenceLedger, "toArray">;
  readonly planSubtasks: ReadonlyArray<SubtaskSummary>;
  readonly planSteps: ReadonlyArray<PlanStep>;
  readonly originalQuery: string;
  readonly turnCount: number;
  readonly doneRejections: number;
  readonly consecutiveSameKindRejections: number;
  readonly lastContractRejectionKind: string | undefined;
  readonly taskId: string | null;
  readonly nodeId: string | null;
  readonly completedResult: unknown;
  readonly limits: { maxDoneRejections: number };
  readonly selectedSkillId: string | null;
  readonly hasReadPage: boolean;
  readonly hasExplicitPageRead: boolean;
  readonly listDetailWorkflow: {
    listDetailReviewedTargets: Set<string>;
    listDetailOpenedTargets: Set<string>;
    listDetailVisibleActionCount: number;
  };
  readonly moneyTable: Pick<
    MoneyTableRuntime,
    "getIncompleteMoneyTableAggregateDoneRejection" | "getIncorrectMoneyTableAggregateDoneRejection"
  >;
  getMissingRequiredEvidenceTypes(): string[];
}

export function getCompletionSummaryTaskContext(host: Pick<
  CompletionDecisionContextHost,
  "originalQuery" | "planSubtasks" | "planSteps"
>): string {
  const runningIdx = host.planSubtasks.findIndex(
    (step) => step.status === "running",
  );
  return [
    host.originalQuery,
    runningIdx >= 0 ? host.planSubtasks[runningIdx]?.description : undefined,
    runningIdx >= 0 ? host.planSteps[runningIdx]?.successCriteria : undefined,
  ]
    .filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    )
    .join("\n");
}

/** Read-only completion inputs, bound to the current loop state. */
export class CompletionDecisionContextRuntime {
  constructor(private readonly host: CompletionDecisionContextHost) {}

  /** Capture the surface before the decision mutates counters or evidence. */
  captureCompletionDecisionInput(summary: string): CompletionDecisionRecordInput {
    const snapshot = this.host.context.getSnapshot() ?? null;
    const completionContext =
      this.host.completionEvidenceRuntime.getActiveCompletionContext();
    const runningSubtaskIndex = this.host.planSubtasks.findIndex(
      (step) => step.status === "running",
    );
    return {
      userRequest: this.host.originalQuery,
      summary,
      candidateSource: "model_done",
      activeObjective: completionContext.activeObjective,
      successCriteria: completionContext.successCriteria,
      snapshot,
      snapshotDigest: computeSnapshotDigest(snapshot),
      evidence: projectKernelEvidence(
        this.host.completionEvidence.toArray(),
        snapshot,
        this.host.turnCount,
      ),
      counters: {
        turnCount: this.host.turnCount,
        doneRejections: this.host.doneRejections,
        consecutiveSameKindRejections: this.host.consecutiveSameKindRejections,
        lastContractRejectionKind: this.host.lastContractRejectionKind ?? null,
      },
      planValidation: {
        hasPlan: Boolean(this.host.taskId) && this.host.planSubtasks.length > 0,
        planSubtaskCount: this.host.planSubtasks.length,
        runningSubtaskIndex,
      },
      guardContext: this.buildCompletionGuardContext(
        summary,
        snapshot,
        completionContext,
        runningSubtaskIndex,
      ),
      isDuplicateTerminal: Boolean(this.host.completedResult),
      // Filled post-inner in recordCompletionDecisionOutcome.
      plannerResult: null,
    };
  }

  /** Assemble the flat input surface consumed by the pure completion guards. */
  buildCompletionGuardContext(
    summary: string,
    snapshot: DomSnapshot | null,
    completionContext: { activeObjective?: string; successCriteria?: string },
    runningSubtaskIndex: number,
  ): CompletionGuardContext {
    const incompleteMoneyTableScan =
      this.host.moneyTable.getIncompleteMoneyTableAggregateDoneRejection();
    return {
      summary,
      userRequest: this.host.originalQuery,
      snapshot,
      taskContext: getCompletionSummaryTaskContext(this.host),
      turnCount: this.host.turnCount,
      isOrchestratorNode: Boolean(this.host.nodeId),
      doneRejections: this.host.doneRejections,
      maxDoneRejections: this.host.limits.maxDoneRejections,
      consecutiveSameKindRejections: this.host.consecutiveSameKindRejections,
      lastContractRejectionKind: this.host.lastContractRejectionKind ?? null,
      planSubtaskCount: this.host.planSubtasks.length,
      runningSubtaskIndex,
      selectedSkillId: this.host.selectedSkillId,
      hasReadPage: this.host.hasReadPage,
      hasExplicitPageRead: this.host.hasExplicitPageRead,
      hasTaskId: Boolean(this.host.taskId),
      missingRequiredEvidence: this.host.getMissingRequiredEvidenceTypes(),
      activeObjective: completionContext.activeObjective,
      successCriteria: completionContext.successCriteria,
      listDetailReviewedCount:
        this.host.listDetailWorkflow.listDetailReviewedTargets.size,
      listDetailOpenedCount:
        this.host.listDetailWorkflow.listDetailOpenedTargets.size,
      listDetailVisibleActionCount: Math.max(
        this.host.listDetailWorkflow.listDetailVisibleActionCount,
        countVisibleListDetailActions(snapshot),
      ),
      moneyTableIncompleteScanReason: incompleteMoneyTableScan,
      moneyTableIncorrectAnswerReason: incompleteMoneyTableScan
        ? null
        : this.host.moneyTable.getIncorrectMoneyTableAggregateDoneRejection(
            summary,
          ),
    };
  }
}
