import { RiskLevel, ToolName, type AgentStep } from "../../types";
import type { PreToolDecision } from "./middleware";

export function getPreToolDeniedMessage(preDecision: PreToolDecision): string {
  return `Error: ${preDecision.denyReason || "Blocked by policy middleware."}`;
}

export function shouldReportApprovalBypass(
  preDecision: PreToolDecision,
): boolean {
  return (
    preDecision.approvalMode === "bypassed" &&
    preDecision.riskLevel === RiskLevel.HIGH
  );
}

export function buildApprovalBypassedStep(input: {
  id: string;
  label: string;
  timestamp: number;
  toolName: ToolName;
}): AgentStep {
  return {
    id: input.id,
    type: "info",
    label: `Approval bypassed: ${input.label}`,
    status: "done",
    timestamp: input.timestamp,
    toolName: input.toolName,
  };
}
