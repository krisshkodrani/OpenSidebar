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

describe("completion kernel download file-transfer workflow confirmation", () => {
  test("accepts download confirmation from named file disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending downloads File Alpha Download File Alpha File Beta Download File Beta",
      pageContent:
        "Pending downloads File Alpha Download File Alpha File Beta Download File Beta",
      elements: [
        actionButton(555, "Download File Alpha"),
        actionButton(556, "Download File Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending downloads File Beta Download File Beta",
      pageContent: "Pending downloads File Beta Download File Beta",
      elements: [actionButton(556, "Download File Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Download File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 555 },
      result: "Clicked element 555.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Downloaded File Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "download",
      targetLabel: "File Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:download:file-alpha",
        detail: expect.objectContaining({
          action: "download",
          source: "target_disappearance",
          text: "Downloaded target no longer visible: File Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects download target-disappearance evidence for the wrong requested file", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending downloads File Alpha Download File Alpha File Beta Download File Beta",
      pageContent:
        "Pending downloads File Alpha Download File Alpha File Beta Download File Beta",
      elements: [
        actionButton(555, "Download File Alpha"),
        actionButton(556, "Download File Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending downloads File Alpha Download File Alpha",
      pageContent: "Pending downloads File Alpha Download File Alpha",
      elements: [actionButton(555, "Download File Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Download File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 556 },
      result: "Clicked element 556.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Downloaded File Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "download",
      targetLabel: "File Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:download:file-beta",
        detail: expect.objectContaining({
          action: "download",
          source: "target_disappearance",
          text: "Downloaded target no longer visible: File Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer download confirmation while the named file remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending downloads File Alpha Download File Alpha",
      pageContent: "Pending downloads File Alpha Download File Alpha",
      elements: [actionButton(555, "Download File Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending downloads File Alpha Download File Alpha",
      pageContent: "Pending downloads File Alpha Download File Alpha",
      elements: [actionButton(555, "Download File Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 555 },
      result: "Clicked element 555.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer download confirmation from a generic download file control", () => {
    const genericDownloadFileButton: TaggedElement = {
      tag: 555,
      tagName: "button",
      role: "button",
      text: "Download file",
      attributes: {
        id: "download-file",
        "aria-label": "Download file",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending downloads File Alpha Download file",
      pageContent: "Pending downloads File Alpha Download file",
      elements: [genericDownloadFileButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending downloads",
      pageContent: "Pending downloads",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 555 },
      result: "Clicked element 555.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
