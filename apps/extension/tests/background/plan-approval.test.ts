import { describe, expect, test, vi } from "vitest";
import { createFakeEnvironment } from "../fakes/environment";
import { PlanApprovalBridge } from "../../src/background/browser-bridge/plan-approval";
import { PendingResolverRegistry } from "../../src/background/orchestrator/pending-resolver-registry";

describe("remote plan review", () => {
  test("forwards the concrete plan and routes only its workspace-bound decision", () => {
    const { env } = createFakeEnvironment();
    const respond = vi.fn(() => true);
    const bridge = new PlanApprovalBridge(env.messaging, respond, () => 100);
    const listener = vi.fn();
    const off = bridge.observe(listener);
    env.messaging.broadcast({ type: "PLAN_CONFIRMATION_REQUEST", workspaceId: "remote", payload: {
      confirmationId: "plan-1", nodes: [{ description: "Read the selected page", successCriteria: "Heading observed" }], query: "Read it",
    } });
    expect(listener).toHaveBeenCalledWith("remote", expect.objectContaining({ interaction: expect.objectContaining({
      approvalId: "plan-1", toolName: "review_plan", context: expect.stringContaining("Read the selected page"),
    }) }));
    expect(bridge.resolve("other", "plan-1", true)).toBe(false);
    expect(respond).not.toHaveBeenCalled();
    expect(bridge.resolve("remote", "plan-1", true)).toBe(true);
    expect(respond).toHaveBeenCalledWith({ confirmationId: "plan-1", decision: "approve" });
    expect(bridge.resolve("remote", "plan-1", true)).toBeUndefined();
    off();
  });

  test("expired plan permission is cancelled, never approved", () => {
    const { env } = createFakeEnvironment();
    let now = 0;
    const respond = vi.fn(() => true);
    const bridge = new PlanApprovalBridge(env.messaging, respond, () => now);
    const off = bridge.observe(() => {});
    env.messaging.broadcast({ type: "PLAN_CONFIRMATION_REQUEST", workspaceId: "remote", payload: { confirmationId: "plan", nodes: [], query: "Read it" } });
    now = 600_001;
    expect(bridge.resolve("remote", "plan", true)).toBe(false);
    expect(respond).toHaveBeenCalledWith({ confirmationId: "plan", decision: "cancel" });
    off();
  });

  test("stopping one workspace leaves another workspace's plan pending", () => {
    const registry = new PendingResolverRegistry<string>();
    const local = vi.fn();
    const remote = vi.fn();
    registry.register("local-plan", local, "local");
    registry.register("remote-plan", remote, "remote");
    registry.resolveScope("local", "cancel");
    expect(local).toHaveBeenCalledWith("cancel");
    expect(remote).not.toHaveBeenCalled();
    expect(registry.get("remote-plan")).toBe(remote);
    expect(registry.get("local-plan")).toBeUndefined();
  });
});
