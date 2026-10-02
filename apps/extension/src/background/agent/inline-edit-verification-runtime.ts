import { ToolName, type SubtaskSummary } from "../../types";
import type { ContextManager } from "./context";
import type { PlanStep } from "./planner";
import type { SkillToolRuntime } from "./loop-skill-tools";
import { getUncommittedInlineEditDoneRejection as checkUncommittedInlineEditDoneRejection } from "./inline-edit-policy";

export interface InlineEditVerificationHost {
  readonly skillTools: Pick<SkillToolRuntime, "getActiveToolProfileForStep">;
  readonly context: Pick<ContextManager, "getSnapshot">;
  readonly originalQuery: string;
  readonly planSubtasks: ReadonlyArray<SubtaskSummary>;
  readonly planSteps: ReadonlyArray<PlanStep>;
  pendingInlineEditVerification: { stepIndex: number; reason: string } | null;
}

/** Enforce committed inline edits before further mutations or completion. */
export class InlineEditVerificationRuntime {
  constructor(private readonly host: InlineEditVerificationHost) {}

  getUncommittedInlineEditDoneRejection(
    currentStepIndex: number,
  ): string | null {
    return checkUncommittedInlineEditDoneRejection({
      toolProfile:
        this.host.skillTools.getActiveToolProfileForStep(currentStepIndex),
      snapshot: this.host.context.getSnapshot(),
      taskText: `${this.host.originalQuery}\n${this.host.planSubtasks[currentStepIndex]?.description || ""}\n${this.host.planSteps[currentStepIndex]?.successCriteria || ""}`,
    });
  }

  getPendingInlineEditVerificationBlock(
    toolName: ToolName,
    currentStepIndex: number,
  ): string | null {
    if (
      this.host.pendingInlineEditVerification &&
      this.host.pendingInlineEditVerification.stepIndex !== currentStepIndex
    ) {
      this.host.pendingInlineEditVerification = null;
    }
    if (
      !this.host.pendingInlineEditVerification ||
      this.host.pendingInlineEditVerification.stepIndex !== currentStepIndex
    ) {
      return null;
    }
    if (
      [
        ToolName.READ_PAGE,
        ToolName.READ_ELEMENT,
        ToolName.FIND_ELEMENT,
        ToolName.WAIT,
      ].includes(toolName)
    ) {
      return null;
    }
    return (
      `${this.host.pendingInlineEditVerification.reason} ` +
      "Verify the committed page state with read_page, read_element, or find_element before taking another action."
    );
  }
}
