import { RiskLevel } from "../../types";

export type ApprovalPolicyMode = "none" | "required" | "bypassed";

export interface ApprovalPolicyDecision {
  mode: ApprovalPolicyMode;
  requiresApproval: boolean;
  reason: string;
}

/**
 * Centralized approval policy matrix.
 * Keeps enforcement logic deterministic and auditable.
 */
export function resolveApprovalPolicy(
  riskLevel: RiskLevel,
  bypassApprovals: boolean,
): ApprovalPolicyDecision {
  if (riskLevel !== RiskLevel.HIGH) {
    return {
      mode: "none",
      requiresApproval: false,
      reason: "Only high-risk tools require approval.",
    };
  }

  if (bypassApprovals) {
    return {
      mode: "bypassed",
      requiresApproval: false,
      reason: "High-risk approval bypass is enabled in settings.",
    };
  }

  return {
    mode: "required",
    requiresApproval: true,
    reason: "High-risk tool requires explicit user approval.",
  };
}
