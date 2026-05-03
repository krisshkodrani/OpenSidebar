import { describe, expect, test } from "vitest";
import {
  buildApprovalBypassedStep,
  getPreToolDeniedReason,
  getPreToolDeniedMessage,
  shouldReportApprovalBypass,
} from "../../src/background/agent/sequential-pre-tool-gate";
import type { PreToolDecision } from "../../src/background/agent/middleware";
import { RiskLevel, ToolName } from "../../src/types";

function preDecision(
  overrides: Partial<PreToolDecision> = {},
): PreToolDecision {
  return {
    toolName: ToolName.CLICK_ELEMENT,
    riskLevel: RiskLevel.LOW,
    allowed: true,
    requiresApproval: false,
    approvalMode: "none",
    approvalReason: "test",
    ...overrides,
  };
}

describe("sequential pre-tool gate", () => {
  test("formats middleware denial messages", () => {
    expect(
      getPreToolDeniedMessage(
        preDecision({
          allowed: false,
          denyReason: "Tool is disabled.",
        }),
      ),
    ).toBe("Error: Tool is disabled.");
  });

  test("uses the default middleware denial message when no reason is present", () => {
    expect(
      getPreToolDeniedMessage(
        preDecision({
          allowed: false,
        }),
      ),
    ).toBe("Error: Blocked by policy middleware.");
  });

  test("formats middleware denial reasons with branch-specific fallback", () => {
    expect(
      getPreToolDeniedReason(
        preDecision({
          allowed: false,
        }),
        "Tool click_element denied by middleware",
      ),
    ).toBe("Tool click_element denied by middleware");
  });

  test("reports approval bypass only for high-risk bypassed decisions", () => {
    expect(
      shouldReportApprovalBypass(
        preDecision({
          riskLevel: RiskLevel.HIGH,
          approvalMode: "bypassed",
        }),
      ),
    ).toBe(true);
    expect(
      shouldReportApprovalBypass(
        preDecision({
          riskLevel: RiskLevel.LOW,
          approvalMode: "bypassed",
        }),
      ),
    ).toBe(false);
  });

  test("builds approval bypass info steps", () => {
    expect(
      buildApprovalBypassedStep({
        id: "step-1",
        label: "Click Delete",
        timestamp: 123,
        toolName: ToolName.CLICK_ELEMENT,
      }),
    ).toEqual({
      id: "step-1",
      type: "info",
      label: "Approval bypassed: Click Delete",
      status: "done",
      timestamp: 123,
      toolName: ToolName.CLICK_ELEMENT,
    });
  });
});
