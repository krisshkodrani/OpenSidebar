import { describe, expect, test } from "vitest";
import {
  resolveToolApprovalRequest,
  TOOL_APPROVAL_DENIED_MESSAGE,
} from "../../src/background/agent/approval-enforcement";
import type { PreToolDecision } from "../../src/background/agent/middleware";
import { RiskLevel, ToolName } from "../../src/types";

function preDecision(
  riskLevel: RiskLevel,
  requiresApproval: boolean,
): PreToolDecision {
  return {
    toolName: ToolName.CLICK_ELEMENT,
    riskLevel,
    allowed: true,
    requiresApproval,
    approvalMode: requiresApproval ? "required" : "none",
    approvalReason: "test",
  };
}

describe("approval enforcement", () => {
  test("passes through middleware approval requests", () => {
    expect(
      resolveToolApprovalRequest(preDecision(RiskLevel.HIGH, true), false),
    ).toEqual({
      requiresApproval: true,
      forceApproval: false,
      riskLevel: RiskLevel.HIGH,
    });
  });

  test("forces approval for consequential actions even when middleware bypassed it", () => {
    expect(
      resolveToolApprovalRequest(preDecision(RiskLevel.LOW, false), true),
    ).toEqual({
      requiresApproval: true,
      forceApproval: true,
      riskLevel: RiskLevel.LOW,
    });
  });

  test("keeps non-approval actions unblocked", () => {
    expect(
      resolveToolApprovalRequest(preDecision(RiskLevel.LOW, false), false),
    ).toEqual({
      requiresApproval: false,
      forceApproval: false,
      riskLevel: RiskLevel.LOW,
    });
  });

  test("uses a shared denial message", () => {
    expect(TOOL_APPROVAL_DENIED_MESSAGE).toBe(
      "Error: Action denied by user approval policy.",
    );
  });
});
