import { describe, expect, test } from "vitest";

import { ToolName } from "../../src/types";
import type {
  PendingApprovalInteraction,
  PendingClarificationInteraction,
  PendingUserInteraction,
} from "../../src/background/agent/loop-types";
import {
  buildTaskPausedMessage,
  emitPendingInteractionMessage,
  HANDOFF_APPROVAL_TIMEOUT_MS,
} from "../../src/background/orchestrator/pending-interaction";

function approval(
  over: Partial<PendingApprovalInteraction> = {},
): PendingApprovalInteraction {
  return {
    kind: "approval",
    nodeId: "node-1",
    requestedAt: Date.now(),
    approvalId: "a1",
    toolName: ToolName.CLICK_ELEMENT,
    args: { id: 7 },
    context: "Submit the application",
    timeoutMs: HANDOFF_APPROVAL_TIMEOUT_MS,
    ...over,
  };
}

function task(pendingInteraction?: PendingUserInteraction) {
  return { id: "t1", workspaceId: "ws-1", rootTabId: 100, pendingInteraction };
}

describe("buildTaskPausedMessage", () => {
  test("carries the approval fields verbatim, with a computed expiresAt", () => {
    const dryRun = {
      kind: "clean" as const,
      formKey: "form:apply",
      diffHash: "abc",
      entries: [
        { label: "Email", expected: "a@b.com", actual: "a@b.com", status: "match" as const },
      ],
    };
    const requestedAt = Date.now();
    const interaction = approval({ requestedAt, timeoutMs: 600_000, dryRun });
    const msg = buildTaskPausedMessage(task(interaction));

    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("TASK_PAUSED");
    expect(msg!.workspaceId).toBe("ws-1");
    expect(msg!.payload.interaction).toMatchObject({
      approvalId: "a1",
      toolName: "click_element",
      args: { id: 7 },
      context: "Submit the application",
      requestedAt,
      timeoutMs: 600_000,
      expiresAt: requestedAt + 600_000,
      dryRun,
    });
  });

  test("returns null for no interaction, a resolved one, or expiry", () => {
    expect(buildTaskPausedMessage(task(undefined))).toBeNull();
    expect(buildTaskPausedMessage(task(approval({ approved: true })))).toBeNull();
    expect(
      buildTaskPausedMessage(task(approval({ requestedAt: 0, timeoutMs: 1 }))),
    ).toBeNull();
  });

  test("forwards a live clarification with its exact correlation id", () => {
    const requestedAt = Date.now();
    const clarification: PendingClarificationInteraction = {
      kind: "clarification",
      nodeId: "node-1",
      requestedAt,
      clarificationId: "c1",
      question: "Which release track?",
      suggestions: ["Internal", "Closed"],
      timeoutMs: 600_000,
    };
    expect(buildTaskPausedMessage(task(clarification))).toMatchObject({
      type: "TASK_PAUSED",
      workspaceId: "ws-1",
      payload: {
        interaction: {
          kind: "clarification",
          clarificationId: "c1",
          question: "Which release track?",
          suggestions: ["Internal", "Closed"],
          expiresAt: requestedAt + 600_000,
        },
      },
    });
  });
});

describe("emitPendingInteractionMessage", () => {
  test("builds an APPROVAL_REQUEST + attention for a live approval", () => {
    const emission = emitPendingInteractionMessage(task(approval()));
    expect(emission?.message.type).toBe("APPROVAL_REQUEST");
    expect(emission?.message.payload).toMatchObject({
      approvalId: "a1",
      risk: "high",
      context: "Submit the application",
    });
    expect(emission?.attention).toMatchObject({
      workspaceId: "ws-1",
      tabId: 100,
      reason: "Approval required",
    });
  });

  test("returns null when the interaction is resolved", () => {
    expect(
      emitPendingInteractionMessage(task(approval({ approved: false }))),
    ).toBeNull();
  });
});
