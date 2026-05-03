import { RiskLevel, ToolCall, ToolName } from "../../types";
import { classifyRisk } from "../security";
import { DOM_MODIFYING_TOOLS, SEQUENTIAL_TOOLS } from "../tools/metadata";

export interface ParallelToolCallDecision {
  canParallelize: boolean;
  hasSequentialTool: boolean;
  hasHighRiskTool: boolean;
  hasDomModifyingTool: boolean;
}

function classifyToolCallRisk(toolCall: ToolCall): RiskLevel {
  try {
    const parsed = JSON.parse(toolCall.function.arguments || "{}");
    return classifyRisk(toolCall.function.name as ToolName, parsed);
  } catch {
    return classifyRisk(toolCall.function.name as ToolName, {});
  }
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
