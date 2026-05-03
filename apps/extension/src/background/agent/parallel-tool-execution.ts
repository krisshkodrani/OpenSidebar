import { RiskLevel, ToolCall, ToolName } from "../../types";
import { classifyRisk } from "../security";
import { DOM_MODIFYING_TOOLS, SEQUENTIAL_TOOLS } from "../tools/metadata";
import { checkVerificationGate } from "./verification";
import type { PlanStatus } from "./context-types";

export interface ParallelToolCallDecision {
  canParallelize: boolean;
  hasSequentialTool: boolean;
  hasHighRiskTool: boolean;
  hasDomModifyingTool: boolean;
}

export type ParallelToolExecutionResult =
  | {
      toolCall: ToolCall;
      result: string;
      error: null;
    }
  | {
      toolCall: ToolCall;
      result: null;
      error: string;
    };

interface ParallelResultContext {
  addMessage(message: {
    role: "tool";
    tool_call_id: string;
    content: string;
  }): void;
}

interface ParallelVerificationGateHost {
  advanceCompletedSubtasks(): number;
  resetConsecutiveAutoAdvances(): void;
  syncPlanStatus(
    currentIndex: number,
    reason: "step_advanced_by_gate",
    data?: Record<string, unknown>,
  ): void;
  broadcastTaskProgress(currentIndex: number): void;
  addUserMessage(content: string): void;
  logVerificationGate(data: Record<string, unknown>): void;
  recordVerificationGate?(data: Record<string, unknown>): void;
}

function classifyToolCallRisk(toolCall: ToolCall): RiskLevel {
  try {
    const parsed = JSON.parse(toolCall.function.arguments || "{}");
    return classifyRisk(toolCall.function.name as ToolName, parsed);
  } catch {
    return classifyRisk(toolCall.function.name as ToolName, {});
  }
}

export function formatParallelToolResultContent(
  result: ParallelToolExecutionResult,
): string {
  return result.error === null ? result.result : `Error: ${result.error}`;
}

export function addParallelToolResultsToContext(
  context: ParallelResultContext,
  results: ParallelToolExecutionResult[],
): void {
  for (const result of results) {
    context.addMessage({
      role: "tool",
      tool_call_id: result.toolCall.id,
      content: formatParallelToolResultContent(result),
    });
  }
}

export function handleParallelVerificationGate(params: {
  planStatus: PlanStatus | null | undefined;
  results: ParallelToolExecutionResult[];
  currentUrl: string | null;
  host: ParallelVerificationGateHost;
}): void {
  const { planStatus, results, currentUrl, host } = params;
  if (!planStatus) return;

  const currentSub = planStatus.subtasks[planStatus.currentIndex];
  if (!currentSub?.verificationGate) return;

  const gateResult = checkVerificationGate(
    results.map(formatParallelToolResultContent),
    currentSub.verificationGate,
    currentUrl ?? undefined,
  );
  if (!gateResult.matched) return;

  if (currentSub.verificationGate.action === "advance_step") {
    host.resetConsecutiveAutoAdvances();
    const newIdx = host.advanceCompletedSubtasks();
    host.syncPlanStatus(newIdx, "step_advanced_by_gate", {
      evidence: gateResult.evidence,
      mode: "parallel",
      advancedTo: newIdx,
    });
    host.broadcastTaskProgress(newIdx);
    host.addUserMessage(
      `STEP ADVANCED: '${gateResult.evidence}' matched. Now on step ${newIdx + 1}.`,
    );
  } else {
    host.addUserMessage(
      `CHECKPOINT: Gate triggered. Evidence: '${gateResult.evidence}'. Call done() now.`,
    );
  }

  const eventData = {
    action: currentSub.verificationGate.action,
    evidence: gateResult.evidence,
    mode: "parallel",
  };
  host.logVerificationGate(eventData);
  host.recordVerificationGate?.(eventData);
}

export function collectTrailingToolResultMessages(
  messages: Array<{ role: string; content?: unknown }>,
): string[] {
  const toolResults: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "tool") break;
    if (typeof message.content === "string") toolResults.push(message.content);
  }
  return toolResults;
}

export function handleSequentialVerificationGate(params: {
  planStatus: PlanStatus | null | undefined;
  toolResults: string[];
  currentUrl: string | null;
  host: ParallelVerificationGateHost;
}): void {
  const { planStatus, toolResults, currentUrl, host } = params;
  if (!planStatus) return;

  const currentSub = planStatus.subtasks[planStatus.currentIndex];
  if (!currentSub?.verificationGate) return;

  const gateResult = checkVerificationGate(
    toolResults,
    currentSub.verificationGate,
    currentUrl ?? undefined,
  );
  if (!gateResult.matched) return;

  if (currentSub.verificationGate.action === "advance_step") {
    host.resetConsecutiveAutoAdvances();
    const newIdx = host.advanceCompletedSubtasks();
    host.syncPlanStatus(newIdx, "step_advanced_by_gate", {
      evidence: gateResult.evidence,
      mode: "sequential",
      advancedTo: newIdx,
    });
    host.broadcastTaskProgress(newIdx);
    host.addUserMessage(
      `STEP ADVANCED: '${gateResult.evidence}' matched. Now on step ${newIdx + 1}.`,
    );
  } else {
    host.addUserMessage(
      `CHECKPOINT: Gate triggered. Evidence: '${gateResult.evidence}'. Call done() now.`,
    );
  }

  const eventData = {
    action: currentSub.verificationGate.action,
    evidence: gateResult.evidence,
    mode: "sequential",
  };
  host.logVerificationGate(eventData);
  host.recordVerificationGate?.(eventData);
}

export function assessParallelToolCalls(
  toolCalls: ToolCall[],
): ParallelToolCallDecision {
  const hasSequentialTool = toolCalls.some((toolCall) =>
    SEQUENTIAL_TOOLS.has(toolCall.function.name as ToolName),
  );
  const hasHighRiskTool = toolCalls.some(
    (toolCall) => classifyToolCallRisk(toolCall) === RiskLevel.HIGH,
  );
  const hasDomModifyingTool = toolCalls.some((toolCall) =>
    DOM_MODIFYING_TOOLS.has(toolCall.function.name as ToolName),
  );

  return {
    canParallelize:
      !hasSequentialTool &&
      !hasHighRiskTool &&
      !hasDomModifyingTool &&
      toolCalls.length > 1,
    hasSequentialTool,
    hasHighRiskTool,
    hasDomModifyingTool,
  };
}
