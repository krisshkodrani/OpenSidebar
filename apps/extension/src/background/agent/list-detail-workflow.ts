import { DomSnapshot, ToolCall, ToolName } from "../../types";
import { normalizeGuardText } from "./text-entry-guards";
import {
  countVisibleListDetailActions,
  getListDetailReturnControl,
  getListDetailWorkflowBlock,
  getNextUnreviewedListDetailAction,
  hasListDetailReturnControl,
  listDetailActionTargetLabel,
  listDetailElementLabel,
} from "./list-detail-policy";

export interface ListDetailWorkflowHost {
  selectedSkillId(): string | null | undefined;
  turnCount(): number;
  getSnapshot(): DomSnapshot | null;
  query(): string;
  isSkillOwned(): boolean;
  recordEvent(name: string, data: Record<string, unknown>): void;
  logInfo(message: string, data: Record<string, unknown>): void;
}

export interface ListDetailWorkflowState {
  listDetailOpenedTargets: Set<string>;
  listDetailReviewedTargets: Set<string>;
  listDetailVisibleActionCount: number;
}

/** Stateful list-detail tool sequencing, shared by the loop's dispatch paths. */
export class ListDetailWorkflow implements ListDetailWorkflowState {
  readonly listDetailOpenedTargets = new Set<string>();
  readonly listDetailReviewedTargets = new Set<string>();
  listDetailCurrentTarget: string | null = null;
  listDetailCurrentTargetRead = false;
  listDetailVisibleActionCount = 0;

  constructor(private readonly host: ListDetailWorkflowHost) {}

  trackListDetailToolSuccess(
    toolName: ToolName,
    args: Record<string, unknown>,
    preActionSnapshot: DomSnapshot | null,
  ): void {
    if (this.host.selectedSkillId() !== "list-detail-review-loop") return;
    const visibleCount = countVisibleListDetailActions(preActionSnapshot);
    if (visibleCount > this.listDetailVisibleActionCount) {
      this.listDetailVisibleActionCount = visibleCount;
    }

    if (toolName === ToolName.CLICK_ELEMENT) {
      const id = typeof args.id === "number" ? args.id : Number(args.id);
      if (!Number.isFinite(id)) return;
      const target = preActionSnapshot?.elements.find(
        (element) => element.tag === id,
      );
      const label = listDetailActionTargetLabel(target);
      if (!label) return;

      this.listDetailOpenedTargets.add(label);
      this.listDetailCurrentTarget = label;
      this.listDetailCurrentTargetRead = false;
      this.host.recordEvent("list_detail_item_opened", {
        turn: this.host.turnCount(),
        openedCount: this.listDetailOpenedTargets.size,
        reviewedCount: this.listDetailReviewedTargets.size,
        visibleActionCount: this.listDetailVisibleActionCount,
        target: label.slice(0, 160),
      });
      return;
    }

    if (
      toolName === ToolName.READ_PAGE ||
      toolName === ToolName.XRAY_PAGE ||
      toolName === ToolName.UPDATE_NOTES
    ) {
      const appearsToBeListPage =
        countVisibleListDetailActions(preActionSnapshot) >= 3;
      if (appearsToBeListPage && toolName !== ToolName.UPDATE_NOTES) {
        return;
      }
      if (
        appearsToBeListPage &&
        toolName === ToolName.UPDATE_NOTES &&
        !this.listDetailCurrentTargetRead
      ) {
        return;
      }
      this.markCurrentListDetailReviewed(
        toolName === ToolName.UPDATE_NOTES ? "note" : "read",
      );
    }
  }

  private markCurrentListDetailReviewed(source: "read" | "note"): void {
    if (this.host.selectedSkillId() !== "list-detail-review-loop") return;
    if (!this.listDetailCurrentTarget) return;
    if (source === "read") {
      this.listDetailCurrentTargetRead = true;
    }

    const target = this.listDetailCurrentTarget;
    this.listDetailReviewedTargets.add(target);
    this.host.recordEvent("list_detail_item_reviewed", {
      turn: this.host.turnCount(),
      source,
      openedCount: this.listDetailOpenedTargets.size,
      reviewedCount: this.listDetailReviewedTargets.size,
      visibleActionCount: this.listDetailVisibleActionCount,
      target: target.slice(0, 160),
    });
  }

  rewriteListDetailWorkflowToolCall(
    toolCall: ToolCall,
    mode: "parallel" | "sequential",
  ): boolean {
    if (!this.host.isSkillOwned()) return false;

    const toolName = toolCall.function.name as ToolName;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(toolCall.function.arguments || "{}");
    } catch {
      args = {};
    }

    const currentSnapshot = this.host.getSnapshot();
    const visibleDetailActionCount =
      countVisibleListDetailActions(currentSnapshot);
    if (visibleDetailActionCount > this.listDetailVisibleActionCount) {
      this.listDetailVisibleActionCount = visibleDetailActionCount;
    }

    const currentTargetKey = normalizeGuardText(
      this.listDetailCurrentTarget || "",
    );
    const currentTargetNeedsRead =
      !!currentTargetKey &&
      !this.listDetailReviewedTargets.has(currentTargetKey);
    const isOpenDetailSurface =
      currentTargetNeedsRead &&
      visibleDetailActionCount < 3 &&
      hasListDetailReturnControl(currentSnapshot);
    if (
      isOpenDetailSurface &&
      toolName !== ToolName.READ_PAGE &&
      toolName !== ToolName.XRAY_PAGE &&
      toolName !== ToolName.UPDATE_NOTES &&
      toolName !== ToolName.ESCALATE &&
      toolName !== ToolName.DONE
    ) {
      toolCall.function.name = ToolName.READ_PAGE;
      toolCall.function.arguments = "{}";
      this.host.recordEvent("list_detail_workflow_tool_redirected", {
        turn: this.host.turnCount(),
        mode,
        fromTool: toolName,
        toTool: ToolName.READ_PAGE,
        target: this.listDetailCurrentTarget?.slice(0, 160),
        openedDetailCount: this.listDetailOpenedTargets.size,
        reviewedDetailCount: this.listDetailReviewedTargets.size,
        visibleDetailActionCount: this.listDetailVisibleActionCount,
        reason: "current_detail_needs_read",
      });
      this.host.logInfo("List-detail workflow tool redirected", {
        turn: this.host.turnCount(),
        mode,
        fromTool: toolName,
        toTool: ToolName.READ_PAGE,
        reason: "current_detail_needs_read",
      });
      return true;
    }

    const returnControl = getListDetailReturnControl(currentSnapshot);
    const clickId = typeof args.id === "number" ? args.id : Number(args.id);
    const isReturnControlClick =
      toolName === ToolName.CLICK_ELEMENT &&
      Number.isFinite(clickId) &&
      returnControl?.tag === clickId;
    const isDetailReadTool =
      toolName === ToolName.READ_PAGE || toolName === ToolName.XRAY_PAGE;
    const allowDetailReadTool = currentTargetNeedsRead && isDetailReadTool;
    if (
      returnControl &&
      visibleDetailActionCount < 3 &&
      !isReturnControlClick &&
      !allowDetailReadTool &&
      toolName !== ToolName.ESCALATE &&
      toolName !== ToolName.DONE &&
      toolName !== ToolName.UPDATE_NOTES
    ) {
      toolCall.function.name = ToolName.CLICK_ELEMENT;
      toolCall.function.arguments = JSON.stringify({ id: returnControl.tag });
      this.host.recordEvent("list_detail_workflow_tool_redirected", {
        turn: this.host.turnCount(),
        mode,
        fromTool: toolName,
        toTool: ToolName.CLICK_ELEMENT,
        targetId: returnControl.tag,
        target: listDetailElementLabel(returnControl).slice(0, 160),
        openedDetailCount: this.listDetailOpenedTargets.size,
        reviewedDetailCount: this.listDetailReviewedTargets.size,
        visibleDetailActionCount: this.listDetailVisibleActionCount,
        reason: "return_to_list_required",
      });
      this.host.logInfo("List-detail workflow tool redirected", {
        turn: this.host.turnCount(),
        mode,
        fromTool: toolName,
        toTool: ToolName.CLICK_ELEMENT,
        targetId: returnControl.tag,
        reason: "return_to_list_required",
      });
      return true;
    }

    const block = getListDetailWorkflowBlock({
      selectedSkillId: this.host.selectedSkillId(),
      query: this.host.query(),
      toolName,
      args,
      snapshot: currentSnapshot,
      reviewedTargets: this.listDetailReviewedTargets,
      openedTargets: this.listDetailOpenedTargets,
      visibleDetailActionCount: this.listDetailVisibleActionCount,
    });
    if (!block) return false;

    const next = getNextUnreviewedListDetailAction(
      currentSnapshot,
      this.listDetailReviewedTargets,
    );
    if (!next) return false;

    toolCall.function.name = ToolName.CLICK_ELEMENT;
    toolCall.function.arguments = JSON.stringify({ id: next.id });
    this.host.recordEvent("list_detail_workflow_tool_redirected", {
      turn: this.host.turnCount(),
      mode,
      fromTool: toolName,
      toTool: ToolName.CLICK_ELEMENT,
      targetId: next.id,
      target: next.label.slice(0, 160),
      openedDetailCount: this.listDetailOpenedTargets.size,
      reviewedDetailCount: this.listDetailReviewedTargets.size,
      visibleDetailActionCount: this.listDetailVisibleActionCount,
    });
    this.host.logInfo("List-detail workflow tool redirected", {
      turn: this.host.turnCount(),
      mode,
      fromTool: toolName,
      targetId: next.id,
    });
    return true;
  }

}
