import { ToolName } from "../../types";
import type { ContextManager } from "./context";
import type { CompletionEvidenceRuntime } from "./completion-evidence";
import type { TrustedCompletionCandidate } from "./completion-kernel";
import type { PlanProgressRuntime } from "./loop-plan-progress";
import type { TraceRecorder } from "./trace";

export interface TrustedListCompletionHost {
  readonly selectedSkillId: string | null;
  readonly completionEvidenceRuntime: Pick<
    CompletionEvidenceRuntime,
    "createTrustedCompletionCandidate"
  >;
  readonly context: Pick<ContextManager, "getPlanStatusRaw">;
  readonly planProgress: Pick<PlanProgressRuntime, "completeRemainingSubtasks">;
  readonly turnCount: number;
  readonly planSubtaskCount: number;
  resetConsecutiveAutoAdvances(): void;
  syncPlanStatus(
    index: number,
    event: "trusted_list_sort_success" | "trusted_list_filter_success",
    data: Record<string, unknown>,
  ): void;
  broadcastTaskProgress(index: number): void;
  logInfo(message: string, data: Record<string, unknown>): void;
  recordEvent: TraceRecorder["recordEvent"];
  isPureListFilterWorkflowRequest(): boolean;
}

/** Complete verified list sort/filter workflows using their trusted tool receipts. */
export class TrustedListCompletionRuntime {
  constructor(private readonly host: TrustedListCompletionHost) {}

  maybeCompleteTrustedListSortStep(params: {
    toolName: string;
    toolArgs?: Record<string, unknown>;
    toolResult: string;
    mode: "parallel" | "sequential";
  }): {
    finalSummary: string;
    newIndex: number;
    completionCandidate: TrustedCompletionCandidate;
  } | null {
    if (this.host.selectedSkillId !== "list-sort-workflow") return null;
    if (params.toolName !== ToolName.APPLY_LIST_SORT) return null;
    if (
      /^error:/i.test(params.toolResult) ||
      !/\bapplied\b/i.test(params.toolResult) ||
      !/\bverified list sort\b/i.test(params.toolResult)
    ) {
      return null;
    }

    const sorts = Array.isArray(params.toolArgs?.sorts)
      ? params.toolArgs.sorts
          .filter(
            (sort): sort is { field: string; direction?: string } =>
              !!sort &&
              typeof sort === "object" &&
              typeof (sort as any).field === "string" &&
              (sort as any).field.trim().length > 0,
          )
          .map((sort) => ({
            field: sort.field.trim(),
            direction: /^asc/i.test(String(sort.direction ?? "ascending"))
              ? "ascending"
              : "descending",
          }))
      : [];
    if (sorts.length === 0) return null;

    const normalizedResult = params.toolResult
      .replace(/\s+/g, " ")
      .toLowerCase();
    const missing = sorts.filter((sort) => {
      const field = sort.field.toLowerCase();
      const shortDirection = sort.direction === "ascending" ? "asc" : "desc";
      return !normalizedResult.includes(`${field} ${shortDirection}`);
    });
    if (missing.length > 0) return null;

    const queryLine =
      params.toolResult
        .split(/\r?\n/)
        .find((line) => /\bquery state:/i.test(line))
        ?.trim() ?? "Query state recorded by apply_list_sort.";
    const sortSummary = sorts
      .map((sort) => `${sort.field} ${sort.direction}`)
      .join("; ");
    const finalSummary = `Applied list sort: ${sortSummary}. Evidence: ${queryLine}`;
    const completionCandidate =
      this.host.completionEvidenceRuntime.createTrustedCompletionCandidate({
        workflow: "list_sort",
        summary: finalSummary,
        reason: "Trusted list sort tool result matched the requested sort.",
        evidenceText: params.toolResult,
      });

    const plan = this.host.context.getPlanStatusRaw();
    if (
      !plan ||
      plan.currentIndex < 0 ||
      plan.currentIndex >= plan.subtasks.length
    ) {
      this.host.logInfo("trusted list sort completed planless workflow", {
        turn: this.host.turnCount,
        mode: params.mode,
        sortCount: sorts.length,
      });
      this.host.recordEvent("trusted_list_sort_success", {
        fromStep: -1,
        toStep: 0,
        reason: finalSummary,
        trustedTool: params.toolName,
        mode: params.mode,
        completedAllSteps: true,
        planless: true,
      });
      return { finalSummary, newIndex: 0, completionCandidate };
    }

    this.host.resetConsecutiveAutoAdvances();
    const fromStep = plan.currentIndex;
    const newIndex = this.host.planProgress.completeRemainingSubtasks(
      fromStep,
      finalSummary,
    );
    this.host.syncPlanStatus(newIndex, "trusted_list_sort_success", {
      reason: finalSummary,
      advancedTo: newIndex,
      mode: params.mode,
      trustedTool: params.toolName,
      sortCount: sorts.length,
    });
    this.host.broadcastTaskProgress(newIndex);
    this.host.logInfo("trusted list sort completed workflow", {
      turn: this.host.turnCount,
      fromStep,
      toStep: newIndex,
      mode: params.mode,
      sortCount: sorts.length,
    });
    this.host.recordEvent("trusted_list_sort_success", {
      fromStep,
      toStep: newIndex,
      reason: finalSummary,
      trustedTool: params.toolName,
      mode: params.mode,
      completedAllSteps: newIndex >= this.host.planSubtaskCount,
    });
    return { finalSummary, newIndex, completionCandidate };
  }

  maybeCompleteTrustedListFilterStep(params: {
    toolName: string;
    toolArgs?: Record<string, unknown>;
    toolResult: string;
    mode: "parallel" | "sequential";
  }): {
    finalSummary: string;
    newIndex: number;
    completionCandidate: TrustedCompletionCandidate;
  } | null {
    if (this.host.selectedSkillId !== "list-filter-workflow") return null;
    if (params.toolName !== ToolName.APPLY_LIST_FILTER) return null;
    if (
      /^error:/i.test(params.toolResult) ||
      !/\bapplied\b/i.test(params.toolResult) ||
      !/\bverified list filter\b/i.test(params.toolResult)
    ) {
      return null;
    }

    const conditions = Array.isArray(params.toolArgs?.conditions)
      ? params.toolArgs.conditions
          .filter(
            (
              condition,
            ): condition is {
              field: string;
              operator?: string;
              value?: unknown;
            } =>
              !!condition &&
              typeof condition === "object" &&
              typeof (condition as any).field === "string" &&
              (condition as any).field.trim().length > 0,
          )
          .map((condition) => ({
            field: condition.field.trim(),
            operator: String(condition.operator ?? "is").trim() || "is",
            value:
              condition.value == null ? "" : String(condition.value).trim(),
          }))
      : [];
    if (conditions.length === 0) return null;

    const normalizedResult = params.toolResult
      .replace(/\s+/g, " ")
      .toLowerCase();
    const missing = conditions.filter((condition) => {
      const field = condition.field.toLowerCase();
      const operator = condition.operator.toLowerCase();
      const value = condition.value.toLowerCase();
      const hasField = normalizedResult.includes(field);
      if (!hasField) return true;
      if (/empty/.test(operator)) {
        return !normalizedResult.includes("empty");
      }
      return value.length > 0 && !normalizedResult.includes(value);
    });
    if (missing.length > 0) return null;

    const queryLine =
      params.toolResult
        .split(/\r?\n/)
        .find((line) => /\bquery state:/i.test(line))
        ?.trim() ?? "Query state recorded by apply_list_filter.";
    const conditionSummary = conditions
      .map((condition) => {
        const value = condition.value.length > 0 ? ` ${condition.value}` : "";
        return `${condition.field} ${condition.operator}${value}`;
      })
      .join("; ");
    const finalSummary = `Applied list filter: ${conditionSummary}. Evidence: ${queryLine}`;
    const completionCandidate =
      this.host.completionEvidenceRuntime.createTrustedCompletionCandidate({
        workflow: "list_filter",
        summary: finalSummary,
        reason: "Trusted list filter tool result matched the requested filter.",
        evidenceText: params.toolResult,
      });

    const plan = this.host.context.getPlanStatusRaw();
    if (
      !plan ||
      plan.currentIndex < 0 ||
      plan.currentIndex >= plan.subtasks.length
    ) {
      if (!this.host.isPureListFilterWorkflowRequest()) return null;
      this.host.logInfo("trusted list filter completed planless workflow", {
        turn: this.host.turnCount,
        mode: params.mode,
        conditionCount: conditions.length,
      });
      this.host.recordEvent("trusted_list_filter_success", {
        fromStep: -1,
        toStep: 0,
        reason: finalSummary,
        trustedTool: params.toolName,
        mode: params.mode,
        completedAllSteps: true,
        planless: true,
      });
      return { finalSummary, newIndex: 0, completionCandidate };
    }

    this.host.resetConsecutiveAutoAdvances();
    const fromStep = plan.currentIndex;
    const newIndex = this.host.planProgress.completeRemainingSubtasks(
      fromStep,
      finalSummary,
    );
    this.host.syncPlanStatus(newIndex, "trusted_list_filter_success", {
      reason: finalSummary,
      advancedTo: newIndex,
      mode: params.mode,
      trustedTool: params.toolName,
      conditionCount: conditions.length,
    });
    this.host.broadcastTaskProgress(newIndex);
    this.host.logInfo("trusted list filter completed workflow", {
      turn: this.host.turnCount,
      fromStep,
      toStep: newIndex,
      mode: params.mode,
      conditionCount: conditions.length,
    });
    this.host.recordEvent("trusted_list_filter_success", {
      fromStep,
      toStep: newIndex,
      reason: finalSummary,
      trustedTool: params.toolName,
      mode: params.mode,
      completedAllSteps: newIndex >= this.host.planSubtaskCount,
    });
    return { finalSummary, newIndex, completionCandidate };
  }
}
