import type { RiskLevel } from "../../types";
import type { PreToolDecision } from "./middleware";

export const TOOL_APPROVAL_DENIED_MESSAGE =
  "Error: Action denied by user approval policy.";

export interface ToolApprovalRequest {
  requiresApproval: boolean;
  forceApproval: boolean;
  riskLevel: RiskLevel;
}

export function resolveToolApprovalRequest(
  preDecision: PreToolDecision,
  forceApproval: boolean,
): ToolApprovalRequest {
  return {
    requiresApproval: preDecision.requiresApproval || forceApproval,
    forceApproval,
    riskLevel: preDecision.riskLevel,
  };
}
