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
  return {
    tag,
    tagName: "button",
    role: "button",
    text: label,
    attributes: {
      id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      "aria-label": label,
    },
    rect: { x: 0, y: tag * 20, width: 120, height: 28 },
    isVisible: true,
    isDisabled: false,
  };
}

function stableActionButton(
  tag: number,
  label: string,
  id: string,
): TaggedElement {
  return {
    ...actionButton(tag, label),
    attributes: {
      id,
      "aria-label": label,
    },
  };
}

describe("completion kernel workflow control-label confirmation", () => {
  test("accepts approve confirmation from same-control label change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request REQ001 Awaiting approval Approve request",
      pageContent: "Request REQ001 Awaiting approval Approve request",
      elements: [
        stableActionButton(607, "Approve request", "request-approval-action"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Request REQ001 Approved",
      pageContent: "Request REQ001 Approved",
      elements: [
        stableActionButton(607, "Approved", "request-approval-action"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Approve the request.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 607 },
      result: "Clicked element 607.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Approved the request.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "approve",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:approve:control:request-approval-action",
        detail: expect.objectContaining({
          action: "approve",
          source: "control_label_change",
          text: "Control label changed to confirmed state: Approved",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts target-aware control-label confirmation for the requested target", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request Alpha Awaiting approval",
      pageContent: "Request Alpha Awaiting approval",
      elements: [
        stableActionButton(630, "Approve Request Alpha", "approve-alpha-action"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Request Alpha Approved",
      pageContent: "Request Alpha Approved",
      elements: [stableActionButton(630, "Approved", "approve-alpha-action")],
    });
    const generated = generateCompletionContract({
      userRequest: "Approve Request Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 630 },
      result: "Clicked element 630.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
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
        logicalKey: "workflow:confirmation:approve:control:approve-alpha-action",
        detail: expect.objectContaining({
          action: "approve",
          source: "control_label_change",
          targetText: "Request Alpha",
          text: "Control label changed to confirmed state: Approved",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware control-label confirmation for a different target", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request Alpha Awaiting approval Request Beta Awaiting approval",
      pageContent: "Request Alpha Awaiting approval Request Beta Awaiting approval",
      elements: [
        stableActionButton(630, "Approve Request Beta", "approve-beta-action"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Request Alpha Awaiting approval Request Beta Approved",
      pageContent: "Request Alpha Awaiting approval Request Beta Approved",
      elements: [stableActionButton(630, "Approved", "approve-beta-action")],
    });
    const generated = generateCompletionContract({
      userRequest: "Approve Request Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 630 },
      result: "Clicked element 630.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
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
        logicalKey: "workflow:confirmation:approve:control:approve-beta-action",
        detail: expect.objectContaining({
          action: "approve",
          source: "control_label_change",
          targetText: "Request Beta",
          text: "Control label changed to confirmed state: Approved",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("keeps generic control-label confirmation valid for a named target", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request Alpha Awaiting approval Approve request",
      pageContent: "Request Alpha Awaiting approval Approve request",
      elements: [
        stableActionButton(630, "Approve request", "request-approval-action"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Request Alpha Approved",
      pageContent: "Request Alpha Approved",
      elements: [
        stableActionButton(630, "Approved", "request-approval-action"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Approve Request Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 630 },
      result: "Clicked element 630.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
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
        logicalKey:
          "workflow:confirmation:approve:control:request-approval-action",
        detail: expect.objectContaining({
          action: "approve",
          source: "control_label_change",
          text: "Control label changed to confirmed state: Approved",
        }),
      }),
    ]);
    expect((evidence[0]?.detail as { targetText?: string }).targetText).toBe(
      undefined,
    );
    expect(decision.status).toBe("accepted");
  });

  test("does not infer control-label confirmation when label was already final", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request REQ001 Approved",
      pageContent: "Request REQ001 Approved",
      elements: [
        stableActionButton(607, "Approved", "request-approval-action"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Request REQ001 Approved",
      pageContent: "Request REQ001 Approved",
      elements: [
        stableActionButton(607, "Approved", "request-approval-action"),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 607 },
      result: "Clicked element 607.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer control-label confirmation without stable identity", () => {
    const preButton = actionButton(607, "Approve request");
    const currentButton = actionButton(607, "Approved");
    const pre = workflowSnapshot({
      visibleContent: "Request REQ001 Awaiting approval Approve request",
      pageContent: "Request REQ001 Awaiting approval Approve request",
      elements: [
        {
          ...preButton,
          attributes: { "aria-label": "Approve request" },
        },
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Request REQ001 Approved",
      pageContent: "Request REQ001 Approved",
      elements: [
        {
          ...currentButton,
          attributes: { "aria-label": "Approved" },
        },
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 607 },
      result: "Clicked element 607.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts update confirmation from same-control up-to-date label change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Settings Edit mode Apply changes",
      pageContent: "Settings Edit mode Apply changes",
      elements: [stableActionButton(608, "Apply changes", "settings-apply")],
    });
    const current = workflowSnapshot({
      visibleContent: "Settings Up to date",
      pageContent: "Settings Up to date",
      elements: [stableActionButton(608, "Up to date", "settings-apply")],
    });
    const generated = generateCompletionContract({
      userRequest: "Apply changes.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 608 },
      result: "Clicked element 608.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Applied changes.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "update",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:update:control:settings-apply",
        detail: expect.objectContaining({
          action: "update",
          source: "control_label_change",
          text: "Control label changed to confirmed state: Up to date",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer up-to-date update confirmation when label was already final", () => {
    const pre = workflowSnapshot({
      visibleContent: "Settings Up to date",
      pageContent: "Settings Up to date",
      elements: [stableActionButton(608, "Up to date", "settings-apply")],
    });
    const current = workflowSnapshot({
      visibleContent: "Settings Up to date",
      pageContent: "Settings Up to date",
      elements: [stableActionButton(608, "Up to date", "settings-apply")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 608 },
      result: "Clicked element 608.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });
});
