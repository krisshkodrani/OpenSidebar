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

describe("completion kernel file-transfer workflow confirmation", () => {
  test("accepts export confirmation from named report disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending exports Report Alpha Export Report Alpha Report Beta Export Report Beta",
      pageContent:
        "Pending exports Report Alpha Export Report Alpha Report Beta Export Report Beta",
      elements: [
        actionButton(553, "Export Report Alpha"),
        actionButton(554, "Export Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending exports Report Beta Export Report Beta",
      pageContent: "Pending exports Report Beta Export Report Beta",
      elements: [actionButton(554, "Export Report Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Export Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 553 },
      result: "Clicked element 553.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Exported Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "export",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:export:report-alpha",
        detail: expect.objectContaining({
          action: "export",
          source: "target_disappearance",
          text: "Exported target no longer visible: Report Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects export target-disappearance evidence for the wrong requested report", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending exports Report Alpha Export Report Alpha Report Beta Export Report Beta",
      pageContent:
        "Pending exports Report Alpha Export Report Alpha Report Beta Export Report Beta",
      elements: [
        actionButton(553, "Export Report Alpha"),
        actionButton(554, "Export Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending exports Report Alpha Export Report Alpha",
      pageContent: "Pending exports Report Alpha Export Report Alpha",
      elements: [actionButton(553, "Export Report Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Export Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 554 },
      result: "Clicked element 554.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Exported Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "export",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:export:report-beta",
        detail: expect.objectContaining({
          action: "export",
          source: "target_disappearance",
          text: "Exported target no longer visible: Report Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer export confirmation while the named report remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending exports Report Alpha Export Report Alpha",
      pageContent: "Pending exports Report Alpha Export Report Alpha",
      elements: [actionButton(553, "Export Report Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending exports Report Alpha Export Report Alpha",
      pageContent: "Pending exports Report Alpha Export Report Alpha",
      elements: [actionButton(553, "Export Report Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 553 },
      result: "Clicked element 553.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer export confirmation from a generic export report control", () => {
    const genericExportReportButton: TaggedElement = {
      tag: 553,
      tagName: "button",
      role: "button",
      text: "Export report",
      attributes: {
        id: "export-report",
        "aria-label": "Export report",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending exports Report Alpha Export report",
      pageContent: "Pending exports Report Alpha Export report",
      elements: [genericExportReportButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending exports",
      pageContent: "Pending exports",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 553 },
      result: "Clicked element 553.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

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

  test("accepts upload confirmation from named file disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending uploads File Alpha Upload File Alpha File Beta Upload File Beta",
      pageContent:
        "Pending uploads File Alpha Upload File Alpha File Beta Upload File Beta",
      elements: [
        actionButton(557, "Upload File Alpha"),
        actionButton(558, "Upload File Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending uploads File Beta Upload File Beta",
      pageContent: "Pending uploads File Beta Upload File Beta",
      elements: [actionButton(558, "Upload File Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Upload File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 557 },
      result: "Clicked element 557.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Uploaded File Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "upload",
      targetLabel: "File Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:upload:file-alpha",
        detail: expect.objectContaining({
          action: "upload",
          source: "target_disappearance",
          text: "Uploaded target no longer visible: File Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects upload target-disappearance evidence for the wrong requested file", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending uploads File Alpha Upload File Alpha File Beta Upload File Beta",
      pageContent:
        "Pending uploads File Alpha Upload File Alpha File Beta Upload File Beta",
      elements: [
        actionButton(557, "Upload File Alpha"),
        actionButton(558, "Upload File Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending uploads File Alpha Upload File Alpha",
      pageContent: "Pending uploads File Alpha Upload File Alpha",
      elements: [actionButton(557, "Upload File Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Upload File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 558 },
      result: "Clicked element 558.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Uploaded File Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "upload",
      targetLabel: "File Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:upload:file-beta",
        detail: expect.objectContaining({
          action: "upload",
          source: "target_disappearance",
          text: "Uploaded target no longer visible: File Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer upload confirmation while the named file remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending uploads File Alpha Upload File Alpha",
      pageContent: "Pending uploads File Alpha Upload File Alpha",
      elements: [actionButton(557, "Upload File Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending uploads File Alpha Upload File Alpha",
      pageContent: "Pending uploads File Alpha Upload File Alpha",
      elements: [actionButton(557, "Upload File Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 557 },
      result: "Clicked element 557.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer upload confirmation from a generic upload file control", () => {
    const genericUploadFileButton: TaggedElement = {
      tag: 557,
      tagName: "button",
      role: "button",
      text: "Upload file",
      attributes: {
        id: "upload-file",
        "aria-label": "Upload file",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending uploads File Alpha Upload file",
      pageContent: "Pending uploads File Alpha Upload file",
      elements: [genericUploadFileButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending uploads",
      pageContent: "Pending uploads",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 557 },
      result: "Clicked element 557.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

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
