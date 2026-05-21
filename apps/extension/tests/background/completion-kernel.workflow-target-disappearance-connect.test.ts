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

describe("completion kernel target-disappearance connect workflow confirmation", () => {
  test("accepts connect confirmation from named connection disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Disconnected integrations Integration Alpha Connect Integration Alpha Integration Beta Connect Integration Beta",
      pageContent:
        "Disconnected integrations Integration Alpha Connect Integration Alpha Integration Beta Connect Integration Beta",
      elements: [
        actionButton(519, "Connect Integration Alpha"),
        actionButton(520, "Connect Integration Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Disconnected integrations Integration Beta Connect Integration Beta",
      pageContent:
        "Disconnected integrations Integration Beta Connect Integration Beta",
      elements: [actionButton(520, "Connect Integration Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Connect Integration Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 519 },
      result: "Clicked element 519.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Connected Integration Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "connect",
      targetLabel: "Integration Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:connect:integration-alpha",
        detail: expect.objectContaining({
          action: "connect",
          source: "target_disappearance",
          text: "Connected target no longer visible: Integration Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects connect target-disappearance evidence for the wrong requested connection", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Disconnected integrations Integration Alpha Connect Integration Alpha Integration Beta Connect Integration Beta",
      pageContent:
        "Disconnected integrations Integration Alpha Connect Integration Alpha Integration Beta Connect Integration Beta",
      elements: [
        actionButton(519, "Connect Integration Alpha"),
        actionButton(520, "Connect Integration Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Disconnected integrations Integration Alpha Connect Integration Alpha",
      pageContent:
        "Disconnected integrations Integration Alpha Connect Integration Alpha",
      elements: [actionButton(519, "Connect Integration Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Connect Integration Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 520 },
      result: "Clicked element 520.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Connected Integration Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "connect",
      targetLabel: "Integration Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:connect:integration-beta",
        detail: expect.objectContaining({
          action: "connect",
          source: "target_disappearance",
          text: "Connected target no longer visible: Integration Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer connect confirmation while the named connection remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Disconnected integrations Integration Alpha Connect Integration Alpha",
      pageContent:
        "Disconnected integrations Integration Alpha Connect Integration Alpha",
      elements: [actionButton(519, "Connect Integration Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Disconnected integrations Integration Alpha Connect Integration Alpha",
      pageContent:
        "Disconnected integrations Integration Alpha Connect Integration Alpha",
      elements: [actionButton(519, "Connect Integration Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 519 },
      result: "Clicked element 519.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer connect confirmation from a generic connect button", () => {
    const genericConnectButton: TaggedElement = {
      tag: 519,
      tagName: "button",
      role: "button",
      text: "Connect",
      attributes: {
        id: "connect",
        "aria-label": "Connect",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Disconnected integrations Integration Alpha Connect",
      pageContent: "Disconnected integrations Integration Alpha Connect",
      elements: [genericConnectButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Disconnected integrations",
      pageContent: "Disconnected integrations",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 519 },
      result: "Clicked element 519.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
