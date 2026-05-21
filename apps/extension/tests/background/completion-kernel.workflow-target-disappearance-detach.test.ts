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

describe("completion kernel detach target-disappearance attachment workflow confirmation", () => {
  test("accepts detach confirmation from named attachment disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Attachments File Alpha Detach File Alpha File Beta Detach File Beta",
      pageContent:
        "Attachments File Alpha Detach File Alpha File Beta Detach File Beta",
      elements: [
        actionButton(507, "Detach File Alpha"),
        actionButton(508, "Detach File Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Attachments File Beta Detach File Beta",
      pageContent: "Attachments File Beta Detach File Beta",
      elements: [actionButton(508, "Detach File Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Detach File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 507 },
      result: "Clicked element 507.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Detached File Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "detach",
      targetLabel: "File Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:detach:file-alpha",
        detail: expect.objectContaining({
          action: "detach",
          source: "target_disappearance",
          text: "Detached target no longer visible: File Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects detach target-disappearance evidence for the wrong requested attachment", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Attachments File Alpha Detach File Alpha File Beta Detach File Beta",
      pageContent:
        "Attachments File Alpha Detach File Alpha File Beta Detach File Beta",
      elements: [
        actionButton(507, "Detach File Alpha"),
        actionButton(508, "Detach File Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Attachments File Alpha Detach File Alpha",
      pageContent: "Attachments File Alpha Detach File Alpha",
      elements: [actionButton(507, "Detach File Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Detach File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 508 },
      result: "Clicked element 508.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Detached File Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "detach",
      targetLabel: "File Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:detach:file-beta",
        detail: expect.objectContaining({
          action: "detach",
          source: "target_disappearance",
          text: "Detached target no longer visible: File Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer detach confirmation while the named attachment remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Attachments File Alpha Detach File Alpha",
      pageContent: "Attachments File Alpha Detach File Alpha",
      elements: [actionButton(507, "Detach File Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Attachments File Alpha Detach File Alpha",
      pageContent: "Attachments File Alpha Detach File Alpha",
      elements: [actionButton(507, "Detach File Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 507 },
      result: "Clicked element 507.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer detach confirmation from a generic detach button", () => {
    const genericDetachButton: TaggedElement = {
      tag: 507,
      tagName: "button",
      role: "button",
      text: "Detach",
      attributes: {
        id: "detach",
        "aria-label": "Detach",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Attachments File Alpha Detach",
      pageContent: "Attachments File Alpha Detach",
      elements: [genericDetachButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Attachments",
      pageContent: "Attachments",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 507 },
      result: "Clicked element 507.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
