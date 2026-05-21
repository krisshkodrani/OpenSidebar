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

describe("completion kernel target-disappearance update workflow confirmation", () => {
  test("accepts update confirmation from named package disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending updates Package Alpha Update Package Alpha Package Beta Update Package Beta",
      pageContent:
        "Pending updates Package Alpha Update Package Alpha Package Beta Update Package Beta",
      elements: [
        actionButton(549, "Update Package Alpha"),
        actionButton(550, "Update Package Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending updates Package Beta Update Package Beta",
      pageContent: "Pending updates Package Beta Update Package Beta",
      elements: [actionButton(550, "Update Package Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Update Package Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 549 },
      result: "Clicked element 549.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Updated Package Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "update",
      targetLabel: "Package Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:update:package-alpha",
        detail: expect.objectContaining({
          action: "update",
          source: "target_disappearance",
          text: "Updated target no longer visible: Package Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects update target-disappearance evidence for the wrong requested package", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending updates Package Alpha Update Package Alpha Package Beta Update Package Beta",
      pageContent:
        "Pending updates Package Alpha Update Package Alpha Package Beta Update Package Beta",
      elements: [
        actionButton(549, "Update Package Alpha"),
        actionButton(550, "Update Package Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending updates Package Alpha Update Package Alpha",
      pageContent: "Pending updates Package Alpha Update Package Alpha",
      elements: [actionButton(549, "Update Package Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Update Package Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 550 },
      result: "Clicked element 550.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Updated Package Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "update",
      targetLabel: "Package Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:update:package-beta",
        detail: expect.objectContaining({
          action: "update",
          source: "target_disappearance",
          text: "Updated target no longer visible: Package Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer update confirmation while the named package remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending updates Package Alpha Update Package Alpha",
      pageContent: "Pending updates Package Alpha Update Package Alpha",
      elements: [actionButton(549, "Update Package Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending updates Package Alpha Update Package Alpha",
      pageContent: "Pending updates Package Alpha Update Package Alpha",
      elements: [actionButton(549, "Update Package Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 549 },
      result: "Clicked element 549.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer update confirmation from a generic update package control", () => {
    const genericUpdatePackageButton: TaggedElement = {
      tag: 549,
      tagName: "button",
      role: "button",
      text: "Update package",
      attributes: {
        id: "update-package",
        "aria-label": "Update package",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending updates Package Alpha Update package",
      pageContent: "Pending updates Package Alpha Update package",
      elements: [genericUpdatePackageButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending updates",
      pageContent: "Pending updates",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 549 },
      result: "Clicked element 549.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
