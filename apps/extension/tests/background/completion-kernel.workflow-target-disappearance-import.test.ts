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

describe("completion kernel import file-transfer workflow confirmation", () => {
  test("accepts import confirmation from named file disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending imports File Alpha Import File Alpha File Beta Import File Beta",
      pageContent:
        "Pending imports File Alpha Import File Alpha File Beta Import File Beta",
      elements: [
        actionButton(559, "Import File Alpha"),
        actionButton(560, "Import File Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending imports File Beta Import File Beta",
      pageContent: "Pending imports File Beta Import File Beta",
      elements: [actionButton(560, "Import File Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Import File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 559 },
      result: "Clicked element 559.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Imported File Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "import",
      targetLabel: "File Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:import:file-alpha",
        detail: expect.objectContaining({
          action: "import",
          source: "target_disappearance",
          text: "Imported target no longer visible: File Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects import target-disappearance evidence for the wrong requested file", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending imports File Alpha Import File Alpha File Beta Import File Beta",
      pageContent:
        "Pending imports File Alpha Import File Alpha File Beta Import File Beta",
      elements: [
        actionButton(559, "Import File Alpha"),
        actionButton(560, "Import File Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending imports File Alpha Import File Alpha",
      pageContent: "Pending imports File Alpha Import File Alpha",
      elements: [actionButton(559, "Import File Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Import File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 560 },
      result: "Clicked element 560.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Imported File Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "import",
      targetLabel: "File Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:import:file-beta",
        detail: expect.objectContaining({
          action: "import",
          source: "target_disappearance",
          text: "Imported target no longer visible: File Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer import confirmation while the named file remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending imports File Alpha Import File Alpha",
      pageContent: "Pending imports File Alpha Import File Alpha",
      elements: [actionButton(559, "Import File Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending imports File Alpha Import File Alpha",
      pageContent: "Pending imports File Alpha Import File Alpha",
      elements: [actionButton(559, "Import File Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 559 },
      result: "Clicked element 559.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer import confirmation from a generic import file control", () => {
    const genericImportFileButton: TaggedElement = {
      tag: 559,
      tagName: "button",
      role: "button",
      text: "Import file",
      attributes: {
        id: "import-file",
        "aria-label": "Import file",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending imports File Alpha Import file",
      pageContent: "Pending imports File Alpha Import file",
      elements: [genericImportFileButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending imports",
      pageContent: "Pending imports",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 559 },
      result: "Clicked element 559.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
