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

function rowElement(tag: number, text: string): TaggedElement {
  const key = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    tag,
    tagName: "tr",
    role: "row",
    text,
    attributes: {
      id: `row-${key}`,
    },
    rect: { x: 0, y: tag * 20, width: 600, height: 32 },
    isVisible: true,
    isDisabled: false,
  };
}

describe("completion kernel collaboration invitation row-state confirmation", () => {
  test("accepts invite confirmation from visible pending invitation row", () => {
    const pre = workflowSnapshot({
      visibleContent: "Members Member Alpha Invite Member Alpha",
      pageContent: "Members Member Alpha Invite Member Alpha",
      elements: [actionButton(569, "Invite Member Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending invitations Member Alpha Pending invitation",
      pageContent: "Pending invitations Member Alpha Pending invitation",
      elements: [rowElement(641, "Member Alpha Pending invitation")],
    });
    const generated = generateCompletionContract({
      userRequest: "Invite Member Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 569 },
      result: "Clicked element 569.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Invited Member Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "invite",
      targetLabel: "Member Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:invite:row:member-alpha",
        detail: expect.objectContaining({
          action: "invite",
          source: "invite_row_state",
          targetText: "Member Alpha",
          text: "Invitation row visible: Member Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects invite row-state evidence for the wrong requested member", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Members Member Alpha Invite Member Alpha Member Beta Invite Member Beta",
      pageContent:
        "Members Member Alpha Invite Member Alpha Member Beta Invite Member Beta",
      elements: [
        actionButton(569, "Invite Member Alpha"),
        actionButton(570, "Invite Member Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending invitations Member Beta Pending invitation",
      pageContent: "Pending invitations Member Beta Pending invitation",
      elements: [rowElement(641, "Member Beta Pending invitation")],
    });
    const generated = generateCompletionContract({
      userRequest: "Invite Member Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 570 },
      result: "Clicked element 570.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Invited Member Alpha.",
    });

    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:invite:row:member-beta",
        detail: expect.objectContaining({
          action: "invite",
          source: "invite_row_state",
          targetText: "Member Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer invite row-state evidence from plain visible text", () => {
    const pre = workflowSnapshot({
      visibleContent: "Members Member Alpha Invite Member Alpha",
      pageContent: "Members Member Alpha Invite Member Alpha",
      elements: [actionButton(569, "Invite Member Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending invitations Member Alpha Pending invitation",
      pageContent: "Pending invitations Member Alpha Pending invitation",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 569 },
      result: "Clicked element 569.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer invite row-state evidence from a row that already existed", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending invitations Member Alpha Pending invitation Members Member Alpha Invite Member Alpha",
      pageContent:
        "Pending invitations Member Alpha Pending invitation Members Member Alpha Invite Member Alpha",
      elements: [
        rowElement(641, "Member Alpha Pending invitation"),
        actionButton(569, "Invite Member Alpha"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending invitations Member Alpha Pending invitation",
      pageContent: "Pending invitations Member Alpha Pending invitation",
      elements: [rowElement(641, "Member Alpha Pending invitation")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 569 },
      result: "Clicked element 569.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer invite row-state evidence without invitation state text", () => {
    const pre = workflowSnapshot({
      visibleContent: "Members Member Alpha Invite Member Alpha",
      pageContent: "Members Member Alpha Invite Member Alpha",
      elements: [actionButton(569, "Invite Member Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Members Member Alpha Viewer",
      pageContent: "Members Member Alpha Viewer",
      elements: [rowElement(641, "Member Alpha Viewer")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 569 },
      result: "Clicked element 569.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
