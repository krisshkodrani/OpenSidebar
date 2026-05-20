import { describe, expect, test } from "vitest";
import "../setup";
import {
  deriveCompletionEvidenceFromToolOutcome,
  evaluateCompletionContract,
  generateCompletionContract,
} from "../../src/background/agent/completion-kernel";
import { ToolName, type DomSnapshot, type TaggedElement } from "../../src/types";

function workflowSnapshot(overrides: Partial<DomSnapshot> = {}): DomSnapshot {
  return {
    title: "Account Settings",
    url: "https://example.test/account",
    visibleContent: "Account settings",
    pageContent: "Account settings",
    elements: [],
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    ...overrides,
  };
}

function actionButton(tag: number, label: string): TaggedElement {
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    tag,
    tagName: "button",
    role: "button",
    text: label,
    attributes: {
      id: key,
      "aria-label": label,
    },
    rect: { x: 500, y: tag * 20, width: 120, height: 32 },
    isVisible: true,
    isDisabled: false,
  };
}

describe("completion kernel target-disappearance status lifecycle workflow confirmation", () => {
  test("accepts rollback confirmation from named release disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending rollbacks Release Alpha Rollback Release Alpha Release Beta Rollback Release Beta",
      pageContent:
        "Pending rollbacks Release Alpha Rollback Release Alpha Release Beta Rollback Release Beta",
      elements: [
        actionButton(531, "Rollback Release Alpha"),
        actionButton(532, "Rollback Release Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending rollbacks Release Beta Rollback Release Beta",
      pageContent: "Pending rollbacks Release Beta Rollback Release Beta",
      elements: [actionButton(532, "Rollback Release Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Rollback Release Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 531 },
      result: "Clicked element 531.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Rolled back Release Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "rollback",
      targetLabel: "Release Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:rollback:release-alpha",
        detail: expect.objectContaining({
          action: "rollback",
          source: "target_disappearance",
          text: "Rolled back target no longer visible: Release Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects rollback target-disappearance evidence for the wrong requested release", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending rollbacks Release Alpha Rollback Release Alpha Release Beta Rollback Release Beta",
      pageContent:
        "Pending rollbacks Release Alpha Rollback Release Alpha Release Beta Rollback Release Beta",
      elements: [
        actionButton(531, "Rollback Release Alpha"),
        actionButton(532, "Rollback Release Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending rollbacks Release Alpha Rollback Release Alpha",
      pageContent: "Pending rollbacks Release Alpha Rollback Release Alpha",
      elements: [actionButton(531, "Rollback Release Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Rollback Release Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 532 },
      result: "Clicked element 532.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Rolled back Release Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "rollback",
      targetLabel: "Release Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:rollback:release-beta",
        detail: expect.objectContaining({
          action: "rollback",
          source: "target_disappearance",
          text: "Rolled back target no longer visible: Release Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer rollback confirmation while the named release remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending rollbacks Release Alpha Rollback Release Alpha",
      pageContent: "Pending rollbacks Release Alpha Rollback Release Alpha",
      elements: [actionButton(531, "Rollback Release Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending rollbacks Release Alpha Rollback Release Alpha",
      pageContent: "Pending rollbacks Release Alpha Rollback Release Alpha",
      elements: [actionButton(531, "Rollback Release Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 531 },
      result: "Clicked element 531.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer rollback confirmation from a generic rollback button", () => {
    const genericRollbackButton: TaggedElement = {
      tag: 531,
      tagName: "button",
      role: "button",
      text: "Rollback",
      attributes: {
        id: "rollback",
        "aria-label": "Rollback",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending rollbacks Release Alpha Rollback",
      pageContent: "Pending rollbacks Release Alpha Rollback",
      elements: [genericRollbackButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending rollbacks",
      pageContent: "Pending rollbacks",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 531 },
      result: "Clicked element 531.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts approve confirmation from named request disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending approvals Request Alpha Approve Request Alpha Request Beta Approve Request Beta",
      pageContent:
        "Pending approvals Request Alpha Approve Request Alpha Request Beta Approve Request Beta",
      elements: [
        actionButton(533, "Approve Request Alpha"),
        actionButton(534, "Approve Request Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending approvals Request Beta Approve Request Beta",
      pageContent: "Pending approvals Request Beta Approve Request Beta",
      elements: [actionButton(534, "Approve Request Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Approve Request Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 533 },
      result: "Clicked element 533.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Approved Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "approve",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:approve:request-alpha",
        detail: expect.objectContaining({
          action: "approve",
          source: "target_disappearance",
          text: "Approved target no longer visible: Request Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects approve target-disappearance evidence for the wrong requested request", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending approvals Request Alpha Approve Request Alpha Request Beta Approve Request Beta",
      pageContent:
        "Pending approvals Request Alpha Approve Request Alpha Request Beta Approve Request Beta",
      elements: [
        actionButton(533, "Approve Request Alpha"),
        actionButton(534, "Approve Request Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending approvals Request Alpha Approve Request Alpha",
      pageContent: "Pending approvals Request Alpha Approve Request Alpha",
      elements: [actionButton(533, "Approve Request Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Approve Request Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 534 },
      result: "Clicked element 534.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Approved Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "approve",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:approve:request-beta",
        detail: expect.objectContaining({
          action: "approve",
          source: "target_disappearance",
          text: "Approved target no longer visible: Request Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer approve confirmation while the named request remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending approvals Request Alpha Approve Request Alpha",
      pageContent: "Pending approvals Request Alpha Approve Request Alpha",
      elements: [actionButton(533, "Approve Request Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending approvals Request Alpha Approve Request Alpha",
      pageContent: "Pending approvals Request Alpha Approve Request Alpha",
      elements: [actionButton(533, "Approve Request Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 533 },
      result: "Clicked element 533.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer approve confirmation from a generic approve button", () => {
    const genericApproveButton: TaggedElement = {
      tag: 533,
      tagName: "button",
      role: "button",
      text: "Approve",
      attributes: {
        id: "approve",
        "aria-label": "Approve",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending approvals Request Alpha Approve",
      pageContent: "Pending approvals Request Alpha Approve",
      elements: [genericApproveButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending approvals",
      pageContent: "Pending approvals",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 533 },
      result: "Clicked element 533.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts reject confirmation from named request disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending rejections Request Alpha Reject Request Alpha Request Beta Reject Request Beta",
      pageContent:
        "Pending rejections Request Alpha Reject Request Alpha Request Beta Reject Request Beta",
      elements: [
        actionButton(535, "Reject Request Alpha"),
        actionButton(536, "Reject Request Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending rejections Request Beta Reject Request Beta",
      pageContent: "Pending rejections Request Beta Reject Request Beta",
      elements: [actionButton(536, "Reject Request Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Reject Request Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 535 },
      result: "Clicked element 535.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Rejected Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reject",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:reject:request-alpha",
        detail: expect.objectContaining({
          action: "reject",
          source: "target_disappearance",
          text: "Rejected target no longer visible: Request Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects reject target-disappearance evidence for the wrong requested request", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending rejections Request Alpha Reject Request Alpha Request Beta Reject Request Beta",
      pageContent:
        "Pending rejections Request Alpha Reject Request Alpha Request Beta Reject Request Beta",
      elements: [
        actionButton(535, "Reject Request Alpha"),
        actionButton(536, "Reject Request Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending rejections Request Alpha Reject Request Alpha",
      pageContent: "Pending rejections Request Alpha Reject Request Alpha",
      elements: [actionButton(535, "Reject Request Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Reject Request Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 536 },
      result: "Clicked element 536.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Rejected Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reject",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:reject:request-beta",
        detail: expect.objectContaining({
          action: "reject",
          source: "target_disappearance",
          text: "Rejected target no longer visible: Request Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer reject confirmation while the named request remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending rejections Request Alpha Reject Request Alpha",
      pageContent: "Pending rejections Request Alpha Reject Request Alpha",
      elements: [actionButton(535, "Reject Request Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending rejections Request Alpha Reject Request Alpha",
      pageContent: "Pending rejections Request Alpha Reject Request Alpha",
      elements: [actionButton(535, "Reject Request Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 535 },
      result: "Clicked element 535.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer reject confirmation from a generic reject button", () => {
    const genericRejectButton: TaggedElement = {
      tag: 535,
      tagName: "button",
      role: "button",
      text: "Reject",
      attributes: {
        id: "reject",
        "aria-label": "Reject",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending rejections Request Alpha Reject",
      pageContent: "Pending rejections Request Alpha Reject",
      elements: [genericRejectButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending rejections",
      pageContent: "Pending rejections",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 535 },
      result: "Clicked element 535.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts close confirmation from named ticket disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Open tickets Ticket Alpha Close Ticket Alpha Ticket Beta Close Ticket Beta",
      pageContent:
        "Open tickets Ticket Alpha Close Ticket Alpha Ticket Beta Close Ticket Beta",
      elements: [
        actionButton(537, "Close Ticket Alpha"),
        actionButton(538, "Close Ticket Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tickets Ticket Beta Close Ticket Beta",
      pageContent: "Open tickets Ticket Beta Close Ticket Beta",
      elements: [actionButton(538, "Close Ticket Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Close Ticket Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 537 },
      result: "Clicked element 537.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Closed Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "close",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:close:ticket-alpha",
        detail: expect.objectContaining({
          action: "close",
          source: "target_disappearance",
          text: "Closed target no longer visible: Ticket Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects close target-disappearance evidence for the wrong requested ticket", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Open tickets Ticket Alpha Close Ticket Alpha Ticket Beta Close Ticket Beta",
      pageContent:
        "Open tickets Ticket Alpha Close Ticket Alpha Ticket Beta Close Ticket Beta",
      elements: [
        actionButton(537, "Close Ticket Alpha"),
        actionButton(538, "Close Ticket Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tickets Ticket Alpha Close Ticket Alpha",
      pageContent: "Open tickets Ticket Alpha Close Ticket Alpha",
      elements: [actionButton(537, "Close Ticket Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Close Ticket Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 538 },
      result: "Clicked element 538.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Closed Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "close",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:close:ticket-beta",
        detail: expect.objectContaining({
          action: "close",
          source: "target_disappearance",
          text: "Closed target no longer visible: Ticket Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer close confirmation while the named ticket remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Open tickets Ticket Alpha Close Ticket Alpha",
      pageContent: "Open tickets Ticket Alpha Close Ticket Alpha",
      elements: [actionButton(537, "Close Ticket Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tickets Ticket Alpha Close Ticket Alpha",
      pageContent: "Open tickets Ticket Alpha Close Ticket Alpha",
      elements: [actionButton(537, "Close Ticket Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 537 },
      result: "Clicked element 537.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer close confirmation from a generic close button", () => {
    const genericCloseButton: TaggedElement = {
      tag: 537,
      tagName: "button",
      role: "button",
      text: "Close",
      attributes: {
        id: "close",
        "aria-label": "Close",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Open tickets Ticket Alpha Close",
      pageContent: "Open tickets Ticket Alpha Close",
      elements: [genericCloseButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tickets",
      pageContent: "Open tickets",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 537 },
      result: "Clicked element 537.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer close workflow confirmation from a generic close dialog control", () => {
    const closeDialogButton: TaggedElement = {
      tag: 537,
      tagName: "button",
      role: "button",
      text: "Close dialog",
      attributes: {
        id: "close-dialog",
        "aria-label": "Close dialog",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Settings dialog Close dialog",
      pageContent: "Settings dialog Close dialog",
      elements: [closeDialogButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Settings",
      pageContent: "Settings",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 537 },
      result: "Clicked element 537.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts reopen confirmation from named ticket disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Closed tickets Ticket Alpha Reopen Ticket Alpha Ticket Beta Reopen Ticket Beta",
      pageContent:
        "Closed tickets Ticket Alpha Reopen Ticket Alpha Ticket Beta Reopen Ticket Beta",
      elements: [
        actionButton(539, "Reopen Ticket Alpha"),
        actionButton(540, "Reopen Ticket Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Closed tickets Ticket Beta Reopen Ticket Beta",
      pageContent: "Closed tickets Ticket Beta Reopen Ticket Beta",
      elements: [actionButton(540, "Reopen Ticket Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Reopen Ticket Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 539 },
      result: "Clicked element 539.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Reopened Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reopen",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:reopen:ticket-alpha",
        detail: expect.objectContaining({
          action: "reopen",
          source: "target_disappearance",
          text: "Reopened target no longer visible: Ticket Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects reopen target-disappearance evidence for the wrong requested ticket", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Closed tickets Ticket Alpha Reopen Ticket Alpha Ticket Beta Reopen Ticket Beta",
      pageContent:
        "Closed tickets Ticket Alpha Reopen Ticket Alpha Ticket Beta Reopen Ticket Beta",
      elements: [
        actionButton(539, "Reopen Ticket Alpha"),
        actionButton(540, "Reopen Ticket Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Closed tickets Ticket Alpha Reopen Ticket Alpha",
      pageContent: "Closed tickets Ticket Alpha Reopen Ticket Alpha",
      elements: [actionButton(539, "Reopen Ticket Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Reopen Ticket Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 540 },
      result: "Clicked element 540.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Reopened Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reopen",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:reopen:ticket-beta",
        detail: expect.objectContaining({
          action: "reopen",
          source: "target_disappearance",
          text: "Reopened target no longer visible: Ticket Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer reopen confirmation while the named ticket remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Closed tickets Ticket Alpha Reopen Ticket Alpha",
      pageContent: "Closed tickets Ticket Alpha Reopen Ticket Alpha",
      elements: [actionButton(539, "Reopen Ticket Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Closed tickets Ticket Alpha Reopen Ticket Alpha",
      pageContent: "Closed tickets Ticket Alpha Reopen Ticket Alpha",
      elements: [actionButton(539, "Reopen Ticket Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 539 },
      result: "Clicked element 539.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer reopen confirmation from a generic reopen button", () => {
    const genericReopenButton: TaggedElement = {
      tag: 539,
      tagName: "button",
      role: "button",
      text: "Reopen",
      attributes: {
        id: "reopen",
        "aria-label": "Reopen",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Closed tickets Ticket Alpha Reopen",
      pageContent: "Closed tickets Ticket Alpha Reopen",
      elements: [genericReopenButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Closed tickets",
      pageContent: "Closed tickets",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 539 },
      result: "Clicked element 539.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer reopen confirmation from a generic reopen ticket control", () => {
    const genericReopenTicketButton: TaggedElement = {
      tag: 539,
      tagName: "button",
      role: "button",
      text: "Reopen ticket",
      attributes: {
        id: "reopen-ticket",
        "aria-label": "Reopen ticket",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Closed tickets Ticket Alpha Reopen ticket",
      pageContent: "Closed tickets Ticket Alpha Reopen ticket",
      elements: [genericReopenTicketButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Closed tickets",
      pageContent: "Closed tickets",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 539 },
      result: "Clicked element 539.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts escalate confirmation from named incident disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Open incidents Incident Alpha Escalate Incident Alpha Incident Beta Escalate Incident Beta",
      pageContent:
        "Open incidents Incident Alpha Escalate Incident Alpha Incident Beta Escalate Incident Beta",
      elements: [
        actionButton(541, "Escalate Incident Alpha"),
        actionButton(542, "Escalate Incident Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Open incidents Incident Beta Escalate Incident Beta",
      pageContent: "Open incidents Incident Beta Escalate Incident Beta",
      elements: [actionButton(542, "Escalate Incident Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Escalate Incident Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Escalated Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "escalate",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:escalate:incident-alpha",
        detail: expect.objectContaining({
          action: "escalate",
          source: "target_disappearance",
          text: "Escalated target no longer visible: Incident Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects escalate target-disappearance evidence for the wrong requested incident", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Open incidents Incident Alpha Escalate Incident Alpha Incident Beta Escalate Incident Beta",
      pageContent:
        "Open incidents Incident Alpha Escalate Incident Alpha Incident Beta Escalate Incident Beta",
      elements: [
        actionButton(541, "Escalate Incident Alpha"),
        actionButton(542, "Escalate Incident Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Open incidents Incident Alpha Escalate Incident Alpha",
      pageContent: "Open incidents Incident Alpha Escalate Incident Alpha",
      elements: [actionButton(541, "Escalate Incident Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Escalate Incident Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 542 },
      result: "Clicked element 542.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Escalated Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "escalate",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:escalate:incident-beta",
        detail: expect.objectContaining({
          action: "escalate",
          source: "target_disappearance",
          text: "Escalated target no longer visible: Incident Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer escalate confirmation while the named incident remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Open incidents Incident Alpha Escalate Incident Alpha",
      pageContent: "Open incidents Incident Alpha Escalate Incident Alpha",
      elements: [actionButton(541, "Escalate Incident Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Open incidents Incident Alpha Escalate Incident Alpha",
      pageContent: "Open incidents Incident Alpha Escalate Incident Alpha",
      elements: [actionButton(541, "Escalate Incident Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer escalate confirmation from a generic escalate button", () => {
    const genericEscalateButton: TaggedElement = {
      tag: 541,
      tagName: "button",
      role: "button",
      text: "Escalate",
      attributes: {
        id: "escalate",
        "aria-label": "Escalate",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Open incidents Incident Alpha Escalate",
      pageContent: "Open incidents Incident Alpha Escalate",
      elements: [genericEscalateButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Open incidents",
      pageContent: "Open incidents",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer escalate confirmation from a generic escalate incident control", () => {
    const genericEscalateIncidentButton: TaggedElement = {
      tag: 541,
      tagName: "button",
      role: "button",
      text: "Escalate incident",
      attributes: {
        id: "escalate-incident",
        "aria-label": "Escalate incident",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Open incidents Incident Alpha Escalate incident",
      pageContent: "Open incidents Incident Alpha Escalate incident",
      elements: [genericEscalateIncidentButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Open incidents",
      pageContent: "Open incidents",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not accept deescalate disappearance as escalate confirmation", () => {
    const pre = workflowSnapshot({
      visibleContent: "Open incidents Incident Alpha De-escalate Incident Alpha",
      pageContent: "Open incidents Incident Alpha De-escalate Incident Alpha",
      elements: [actionButton(541, "De-escalate Incident Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Open incidents",
      pageContent: "Open incidents",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Escalate Incident Alpha.",
      snapshot: current,
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Escalated Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "escalate",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:deescalate:incident-alpha",
        detail: expect.objectContaining({
          action: "deescalate",
          source: "target_disappearance",
          text: "De-escalated target no longer visible: Incident Alpha",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "needs_verification",
      reason: "Requested action has no matching visible confirmation evidence yet.",
    });
  });

  test("accepts deescalate confirmation from named incident disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Escalated incidents Incident Alpha De-escalate Incident Alpha Incident Beta De-escalate Incident Beta",
      pageContent:
        "Escalated incidents Incident Alpha De-escalate Incident Alpha Incident Beta De-escalate Incident Beta",
      elements: [
        actionButton(543, "De-escalate Incident Alpha"),
        actionButton(544, "De-escalate Incident Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Escalated incidents Incident Beta De-escalate Incident Beta",
      pageContent:
        "Escalated incidents Incident Beta De-escalate Incident Beta",
      elements: [actionButton(544, "De-escalate Incident Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "De-escalate Incident Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 543 },
      result: "Clicked element 543.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "De-escalated Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "deescalate",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:deescalate:incident-alpha",
        detail: expect.objectContaining({
          action: "deescalate",
          source: "target_disappearance",
          text: "De-escalated target no longer visible: Incident Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects deescalate target-disappearance evidence for the wrong requested incident", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Escalated incidents Incident Alpha De-escalate Incident Alpha Incident Beta De-escalate Incident Beta",
      pageContent:
        "Escalated incidents Incident Alpha De-escalate Incident Alpha Incident Beta De-escalate Incident Beta",
      elements: [
        actionButton(543, "De-escalate Incident Alpha"),
        actionButton(544, "De-escalate Incident Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Escalated incidents Incident Alpha De-escalate Incident Alpha",
      pageContent:
        "Escalated incidents Incident Alpha De-escalate Incident Alpha",
      elements: [actionButton(543, "De-escalate Incident Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "De-escalate Incident Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 544 },
      result: "Clicked element 544.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "De-escalated Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "deescalate",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:deescalate:incident-beta",
        detail: expect.objectContaining({
          action: "deescalate",
          source: "target_disappearance",
          text: "De-escalated target no longer visible: Incident Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer deescalate confirmation while the named incident remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Escalated incidents Incident Alpha De-escalate Incident Alpha",
      pageContent: "Escalated incidents Incident Alpha De-escalate Incident Alpha",
      elements: [actionButton(543, "De-escalate Incident Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Escalated incidents Incident Alpha De-escalate Incident Alpha",
      pageContent: "Escalated incidents Incident Alpha De-escalate Incident Alpha",
      elements: [actionButton(543, "De-escalate Incident Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 543 },
      result: "Clicked element 543.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer deescalate confirmation from a generic deescalate button", () => {
    const genericDeescalateButton: TaggedElement = {
      tag: 543,
      tagName: "button",
      role: "button",
      text: "De-escalate",
      attributes: {
        id: "de-escalate",
        "aria-label": "De-escalate",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Escalated incidents Incident Alpha De-escalate",
      pageContent: "Escalated incidents Incident Alpha De-escalate",
      elements: [genericDeescalateButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Escalated incidents",
      pageContent: "Escalated incidents",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 543 },
      result: "Clicked element 543.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer deescalate confirmation from a generic deescalate incident control", () => {
    const genericDeescalateIncidentButton: TaggedElement = {
      tag: 543,
      tagName: "button",
      role: "button",
      text: "De-escalate incident",
      attributes: {
        id: "de-escalate-incident",
        "aria-label": "De-escalate incident",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Escalated incidents Incident Alpha De-escalate incident",
      pageContent: "Escalated incidents Incident Alpha De-escalate incident",
      elements: [genericDeescalateIncidentButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Escalated incidents",
      pageContent: "Escalated incidents",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 543 },
      result: "Clicked element 543.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts complete confirmation from named task disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Open tasks TASK001 Mark TASK001 complete TASK002 Mark TASK002 complete",
      pageContent:
        "Open tasks TASK001 Mark TASK001 complete TASK002 Mark TASK002 complete",
      elements: [
        actionButton(545, "Mark TASK001 complete"),
        actionButton(546, "Mark TASK002 complete"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tasks TASK002 Mark TASK002 complete",
      pageContent: "Open tasks TASK002 Mark TASK002 complete",
      elements: [actionButton(546, "Mark TASK002 complete")],
    });
    const generated = generateCompletionContract({
      userRequest: "Mark TASK001 complete.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 545 },
      result: "Clicked element 545.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Marked TASK001 complete.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "complete",
      targetLabel: "TASK001",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:complete:task001",
        detail: expect.objectContaining({
          action: "complete",
          source: "target_disappearance",
          text: "Completed target no longer visible: TASK001",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects complete target-disappearance evidence for the wrong requested task", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Open tasks TASK001 Mark TASK001 complete TASK002 Mark TASK002 complete",
      pageContent:
        "Open tasks TASK001 Mark TASK001 complete TASK002 Mark TASK002 complete",
      elements: [
        actionButton(545, "Mark TASK001 complete"),
        actionButton(546, "Mark TASK002 complete"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tasks TASK001 Mark TASK001 complete",
      pageContent: "Open tasks TASK001 Mark TASK001 complete",
      elements: [actionButton(545, "Mark TASK001 complete")],
    });
    const generated = generateCompletionContract({
      userRequest: "Mark TASK001 complete.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 546 },
      result: "Clicked element 546.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Marked TASK001 complete.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "complete",
      targetLabel: "TASK001",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:complete:task002",
        detail: expect.objectContaining({
          action: "complete",
          source: "target_disappearance",
          text: "Completed target no longer visible: TASK002",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer complete confirmation while the named task remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Open tasks TASK001 Mark TASK001 complete",
      pageContent: "Open tasks TASK001 Mark TASK001 complete",
      elements: [actionButton(545, "Mark TASK001 complete")],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tasks TASK001 Mark TASK001 complete",
      pageContent: "Open tasks TASK001 Mark TASK001 complete",
      elements: [actionButton(545, "Mark TASK001 complete")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 545 },
      result: "Clicked element 545.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer complete confirmation from a generic complete button", () => {
    const genericCompleteButton: TaggedElement = {
      tag: 545,
      tagName: "button",
      role: "button",
      text: "Complete",
      attributes: {
        id: "complete",
        "aria-label": "Complete",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Open tasks TASK001 Complete",
      pageContent: "Open tasks TASK001 Complete",
      elements: [genericCompleteButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tasks",
      pageContent: "Open tasks",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 545 },
      result: "Clicked element 545.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer complete confirmation from a generic complete task control", () => {
    const genericCompleteTaskButton: TaggedElement = {
      tag: 545,
      tagName: "button",
      role: "button",
      text: "Complete task",
      attributes: {
        id: "complete-task",
        "aria-label": "Complete task",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Open tasks TASK001 Complete task",
      pageContent: "Open tasks TASK001 Complete task",
      elements: [genericCompleteTaskButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tasks",
      pageContent: "Open tasks",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 545 },
      result: "Clicked element 545.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts submit confirmation from named request disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Draft requests Request Alpha Submit Request Alpha Request Beta Submit Request Beta",
      pageContent:
        "Draft requests Request Alpha Submit Request Alpha Request Beta Submit Request Beta",
      elements: [
        actionButton(547, "Submit Request Alpha"),
        actionButton(548, "Submit Request Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Draft requests Request Beta Submit Request Beta",
      pageContent: "Draft requests Request Beta Submit Request Beta",
      elements: [actionButton(548, "Submit Request Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Submit Request Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 547 },
      result: "Clicked element 547.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Submitted Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "submit",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:submit:request-alpha",
        detail: expect.objectContaining({
          action: "submit",
          source: "target_disappearance",
          text: "Submitted target no longer visible: Request Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects submit target-disappearance evidence for the wrong requested request", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Draft requests Request Alpha Submit Request Alpha Request Beta Submit Request Beta",
      pageContent:
        "Draft requests Request Alpha Submit Request Alpha Request Beta Submit Request Beta",
      elements: [
        actionButton(547, "Submit Request Alpha"),
        actionButton(548, "Submit Request Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Draft requests Request Alpha Submit Request Alpha",
      pageContent: "Draft requests Request Alpha Submit Request Alpha",
      elements: [actionButton(547, "Submit Request Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Submit Request Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 548 },
      result: "Clicked element 548.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Submitted Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "submit",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:submit:request-beta",
        detail: expect.objectContaining({
          action: "submit",
          source: "target_disappearance",
          text: "Submitted target no longer visible: Request Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer submit confirmation while the named request remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Draft requests Request Alpha Submit Request Alpha",
      pageContent: "Draft requests Request Alpha Submit Request Alpha",
      elements: [actionButton(547, "Submit Request Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Draft requests Request Alpha Submit Request Alpha",
      pageContent: "Draft requests Request Alpha Submit Request Alpha",
      elements: [actionButton(547, "Submit Request Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 547 },
      result: "Clicked element 547.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer submit confirmation from a generic submit request control", () => {
    const genericSubmitRequestButton: TaggedElement = {
      tag: 547,
      tagName: "button",
      role: "button",
      text: "Submit request",
      attributes: {
        id: "submit-request",
        "aria-label": "Submit request",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Draft requests Request Alpha Submit request",
      pageContent: "Draft requests Request Alpha Submit request",
      elements: [genericSubmitRequestButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Draft requests",
      pageContent: "Draft requests",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 547 },
      result: "Clicked element 547.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});