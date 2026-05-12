import { RiskLevel, ToolName } from "../../types";
import type { AgentStep } from "../../types";
import type { PreToolDecision } from "./middleware";

export function getPreToolDeniedReason(
  preDecision: PreToolDecision,
  fallback = "Blocked by policy middleware.",
): string {
  return preDecision.denyReason || fallback;
}

export function getPreToolDeniedMessage(preDecision: PreToolDecision): string {
  return `Error: ${getPreToolDeniedReason(preDecision)}`;
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
