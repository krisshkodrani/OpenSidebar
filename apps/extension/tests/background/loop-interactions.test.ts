import { describe, expect, test, vi } from "vitest";
import { AgentStatus, ToolName } from "../../src/types";
import {
  requestApproval,
  requestClarification,
  type InteractionHost,
} from "../../src/background/agent/loop-interactions";
import { PendingInteractionYield } from "../../src/background/agent/start-result";
import type { PendingUserInteraction } from "../../src/background/agent/loop-types";

function makeHost(resumeInteraction: PendingUserInteraction | null = null) {
  const dispatchMessage = vi.fn().mockResolvedValue(undefined);
  const clearResumeInteraction = vi.fn();
  const statusHandler = vi.fn();
  const stepHandler = vi.fn();
  const host: InteractionHost = {
    resumeInteraction,
    clearResumeInteraction,
    nodeId: "node-1",
    approvalTimeoutMs: 60_000,
    turnCount: 3,
    log: { info: vi.fn(), warn: vi.fn() } as InteractionHost["log"],
    traceRecorder: null,
    statusHandler,
    stepHandler,
    workspaceId: "workspace-1",
    workerId: "worker-1",
    bypassApprovals: false,
    dispatchMessage,
  };
  return { host, dispatchMessage, clearResumeInteraction, statusHandler, stepHandler };
}

describe("loop interaction yield and resume", () => {
  test("approval yields the exact request and pauses the loop", async () => {
    const state = makeHost();
    const dryRun = { kind: "clean" as const, formKey: "form-1", diffHash: "hash", entries: [] };
    await expect(
      requestApproval(state.host, ToolName.CLICK_ELEMENT, { id: 7 }, "Submit", dryRun),
    ).rejects.toMatchObject({
      pendingInteraction: {
        kind: "approval",
        toolName: ToolName.CLICK_ELEMENT,
        args: { id: 7 },
        context: "Submit",
        dryRun,
      },
    });
    expect(state.statusHandler).toHaveBeenCalledWith(AgentStatus.PAUSED, "Waiting for approval...");
    expect(state.stepHandler).toHaveBeenCalledWith(expect.objectContaining({ label: "Approval requested: Submit" }), false);
    expect(state.dispatchMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "APPROVAL_REQUEST" }));
  });

  test("restored approval decision returns without a second request", async () => {
    const state = makeHost({
      kind: "approval",
      nodeId: "node-1",
      requestedAt: Date.now(),
      approvalId: "approval-1",
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 7 },
      context: "Submit",
      timeoutMs: 60_000,
      approved: false,
    });
    await expect(requestApproval(state.host, ToolName.CLICK_ELEMENT, { id: 7 }, "Submit")).resolves.toBe(false);
    expect(state.clearResumeInteraction).toHaveBeenCalledOnce();
    expect(state.dispatchMessage).not.toHaveBeenCalled();
  });

  test("expired clarification resolves without dispatch", async () => {
    const state = makeHost({
      kind: "clarification",
      nodeId: "node-1",
      requestedAt: 0,
      clarificationId: "clarification-1",
      question: "Which item?",
      timeoutMs: 1,
    });
    await expect(requestClarification(state.host, "Which item?")).resolves.toBe("No response from user.");
    expect(state.clearResumeInteraction).toHaveBeenCalledOnce();
    expect(state.dispatchMessage).not.toHaveBeenCalled();
  });

  test("clarification yields when no matching response exists", async () => {
    const state = makeHost();
    await expect(requestClarification(state.host, "Which item?", ["First", "Second"])).rejects.toBeInstanceOf(PendingInteractionYield);
    expect(state.statusHandler).toHaveBeenCalledWith(AgentStatus.PAUSED, "Waiting for user clarification...");
    expect(state.dispatchMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "CLARIFICATION_REQUEST" }));
  });
});
