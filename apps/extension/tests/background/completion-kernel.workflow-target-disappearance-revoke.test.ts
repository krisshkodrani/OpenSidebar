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

describe("completion kernel target-disappearance revoke workflow confirmation", () => {
  test("accepts revoke confirmation from named role disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Roles Role Alpha Revoke Role Alpha Role Beta Revoke Role Beta",
      pageContent:
        "Roles Role Alpha Revoke Role Alpha Role Beta Revoke Role Beta",
      elements: [
        actionButton(511, "Revoke Role Alpha"),
        actionButton(512, "Revoke Role Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Roles Role Beta Revoke Role Beta",
      pageContent: "Roles Role Beta Revoke Role Beta",
      elements: [actionButton(512, "Revoke Role Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Revoke Role Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 511 },
      result: "Clicked element 511.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Revoked Role Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "revoke",
      targetLabel: "Role Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:revoke:role-alpha",
        detail: expect.objectContaining({
          action: "revoke",
          source: "target_disappearance",
          text: "Revoked target no longer visible: Role Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects revoke target-disappearance evidence for the wrong requested role", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Roles Role Alpha Revoke Role Alpha Role Beta Revoke Role Beta",
      pageContent:
        "Roles Role Alpha Revoke Role Alpha Role Beta Revoke Role Beta",
      elements: [
        actionButton(511, "Revoke Role Alpha"),
        actionButton(512, "Revoke Role Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Roles Role Alpha Revoke Role Alpha",
      pageContent: "Roles Role Alpha Revoke Role Alpha",
      elements: [actionButton(511, "Revoke Role Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Revoke Role Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 512 },
      result: "Clicked element 512.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Revoked Role Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "revoke",
      targetLabel: "Role Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:revoke:role-beta",
        detail: expect.objectContaining({
          action: "revoke",
          source: "target_disappearance",
          text: "Revoked target no longer visible: Role Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer revoke confirmation while the named role remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Roles Role Alpha Revoke Role Alpha",
      pageContent: "Roles Role Alpha Revoke Role Alpha",
      elements: [actionButton(511, "Revoke Role Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Roles Role Alpha Revoke Role Alpha",
      pageContent: "Roles Role Alpha Revoke Role Alpha",
      elements: [actionButton(511, "Revoke Role Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 511 },
      result: "Clicked element 511.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer revoke confirmation from a generic revoke button", () => {
    const genericRevokeButton: TaggedElement = {
      tag: 511,
      tagName: "button",
      role: "button",
      text: "Revoke",
      attributes: {
        id: "revoke",
        "aria-label": "Revoke",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Roles Role Alpha Revoke",
      pageContent: "Roles Role Alpha Revoke",
      elements: [genericRevokeButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Roles",
      pageContent: "Roles",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 511 },
      result: "Clicked element 511.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
