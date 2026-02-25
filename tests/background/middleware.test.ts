import { describe, expect, test } from "vitest";
import "../setup";
import { RiskLevel, ToolName } from "../../src/types";
import { AgentMiddleware } from "../../src/background/agent/middleware";

function createMiddleware(overrides?: {
  disabledTools?: Set<ToolName>;
  bypassApprovals?: boolean;
}) {
  return new AgentMiddleware({
    disabledTools: overrides?.disabledTools ?? new Set<ToolName>(),
    bypassApprovals: overrides?.bypassApprovals ?? false,
    workspaceId: "ws-test",
    workerId: "worker-test",
    maxSessionMs: 1000,
  });
}

describe("AgentMiddleware", () => {
  test("blocks disabled tools in pre-tool check", () => {
    const middleware = createMiddleware({
      disabledTools: new Set<ToolName>([ToolName.NAVIGATE]),
    });
    const decision = middleware.evaluatePreTool(
      ToolName.NAVIGATE,
      { url: "https://example.com" },
      1,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.denyReason).toContain("disabled");
  });

  test("requires approval for high-risk tool when bypass is off", () => {
    const middleware = createMiddleware({ bypassApprovals: false });
    const decision = middleware.evaluatePreTool(
      ToolName.NAVIGATE,
      { url: "https://example.com" },
      1,
    );
    expect(decision.allowed).toBe(true);
    expect(decision.riskLevel).toBe(RiskLevel.HIGH);
    expect(decision.requiresApproval).toBe(true);
    expect(decision.approvalMode).toBe("required");
  });

  test("does not require approval when bypass is on", () => {
    const middleware = createMiddleware({ bypassApprovals: true });
    const decision = middleware.evaluatePreTool(
      ToolName.NAVIGATE,
      { url: "https://example.com" },
      1,
    );
    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(false);
    expect(decision.approvalMode).toBe("bypassed");
  });

  test("marks medium-risk tools as no-approval policy", () => {
    const middleware = createMiddleware({ bypassApprovals: false });
    const decision = middleware.evaluatePreTool(
      ToolName.CLICK_ELEMENT,
      { id: 3 },
      1,
    );
    expect(decision.allowed).toBe(true);
    expect(decision.riskLevel).toBe(RiskLevel.MEDIUM);
    expect(decision.requiresApproval).toBe(false);
    expect(decision.approvalMode).toBe("none");
  });

  test("marks transient errors as retryable in post-tool check", () => {
    const middleware = createMiddleware();
    const decision = middleware.evaluatePostTool(
      ToolName.CLICK_ELEMENT,
      null,
      "Click intercepted due to overlay",
      40,
      2,
    );
    expect(decision.ok).toBe(false);
    expect(decision.retryable).toBe(true);
  });

  test("halts turn when session budget is exceeded", () => {
    const middleware = createMiddleware();
    const shouldHalt = middleware.shouldHaltTurn(2, 30, Date.now() - 5_000);
    expect(shouldHalt).toBe(true);
  });
});
