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

describe("completion kernel file-transfer result workflow confirmation", () => {
  test("accepts upload confirmation from upload_file result evidence", () => {
    const snap = workflowSnapshot({
      visibleContent: "Upload form File input",
      pageContent: "Upload form File input",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Upload File Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.UPLOAD_FILE,
      args: { id: 557, url: "https://files.example.test/file-alpha.pdf" },
      result: 'Uploaded "File Alpha.pdf" (2048 bytes) to [557] file input',
      currentSnapshot: snap,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
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
        logicalKey: "workflow:confirmation:upload:file-alpha-pdf",
        detail: expect.objectContaining({
          action: "upload",
          source: "upload_file_result",
          targetText: "File Alpha.pdf",
          text: "Uploaded file selected: File Alpha.pdf (2048 bytes)",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects upload_file result evidence for the wrong requested file", () => {
    const snap = workflowSnapshot({
      visibleContent: "Upload form File input",
      pageContent: "Upload form File input",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Upload File Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.UPLOAD_FILE,
      args: { id: 557, url: "https://files.example.test/file-beta.pdf" },
      result: 'Uploaded "File Beta.pdf" (2048 bytes) to [557] file input',
      currentSnapshot: snap,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
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
        logicalKey: "workflow:confirmation:upload:file-beta-pdf",
        detail: expect.objectContaining({
          action: "upload",
          source: "upload_file_result",
          targetText: "File Beta.pdf",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer upload_file result evidence from non-upload result text", () => {
    const snap = workflowSnapshot({
      visibleContent: "Upload form File input",
      pageContent: "Upload form File input",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.UPLOAD_FILE,
      args: { id: 557, url: "https://files.example.test/file-alpha.pdf" },
      result: "Upload started for File Alpha.pdf.",
      currentSnapshot: snap,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts attach confirmation from visible attachment row after upload_file", () => {
    const pre = workflowSnapshot({
      visibleContent: "Attach files File input",
      pageContent: "Attach files File input",
      elements: [],
    });
    const current = workflowSnapshot({
      visibleContent: "Attachments File Alpha.pdf Attached",
      pageContent: "Attachments File Alpha.pdf Attached",
      elements: [rowElement(642, "File Alpha.pdf Attached")],
    });
    const generated = generateCompletionContract({
      userRequest: "Attach File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.UPLOAD_FILE,
      args: { id: 557, url: "https://files.example.test/file-alpha.pdf" },
      result: 'Uploaded "File Alpha.pdf" (2048 bytes) to [557] file input',
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Attached File Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "attach",
      targetLabel: "File Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          confidence: "high",
          logicalKey: "workflow:confirmation:attach:row:file-alpha-pdf",
          detail: expect.objectContaining({
            action: "attach",
            source: "attachment_row_state",
            targetText: "File Alpha.pdf",
            text: "Attachment row visible: File Alpha.pdf",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects attachment row-state evidence for the wrong requested file", () => {
    const pre = workflowSnapshot({
      visibleContent: "Attach files File input",
      pageContent: "Attach files File input",
      elements: [],
    });
    const current = workflowSnapshot({
      visibleContent: "Attachments File Beta.pdf Attached",
      pageContent: "Attachments File Beta.pdf Attached",
      elements: [rowElement(642, "File Beta.pdf Attached")],
    });
    const generated = generateCompletionContract({
      userRequest: "Attach File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.UPLOAD_FILE,
      args: { id: 557, url: "https://files.example.test/file-beta.pdf" },
      result: 'Uploaded "File Beta.pdf" (2048 bytes) to [557] file input',
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Attached File Alpha.",
    });

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          confidence: "high",
          logicalKey: "workflow:confirmation:attach:row:file-beta-pdf",
          detail: expect.objectContaining({
            action: "attach",
            source: "attachment_row_state",
            targetText: "File Beta.pdf",
          }),
        }),
      ]),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer attachment row-state evidence from plain visible text", () => {
    const pre = workflowSnapshot({
      visibleContent: "Attach files File input",
      pageContent: "Attach files File input",
      elements: [],
    });
    const current = workflowSnapshot({
      visibleContent: "Attachments File Alpha.pdf Attached",
      pageContent: "Attachments File Alpha.pdf Attached",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.UPLOAD_FILE,
      args: { id: 557, url: "https://files.example.test/file-alpha.pdf" },
      result: 'Uploaded "File Alpha.pdf" (2048 bytes) to [557] file input',
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: expect.objectContaining({
            source: "attachment_row_state",
          }),
        }),
      ]),
    );
  });

  test("does not infer attachment row-state evidence from a row that already existed", () => {
    const pre = workflowSnapshot({
      visibleContent: "Attachments File Alpha.pdf Attached",
      pageContent: "Attachments File Alpha.pdf Attached",
      elements: [rowElement(642, "File Alpha.pdf Attached")],
    });
    const current = workflowSnapshot({
      visibleContent: "Attachments File Alpha.pdf Attached",
      pageContent: "Attachments File Alpha.pdf Attached",
      elements: [rowElement(642, "File Alpha.pdf Attached")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.UPLOAD_FILE,
      args: { id: 557, url: "https://files.example.test/file-alpha.pdf" },
      result: 'Uploaded "File Alpha.pdf" (2048 bytes) to [557] file input',
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: expect.objectContaining({
            source: "attachment_row_state",
          }),
        }),
      ]),
    );
  });

  test("does not infer attachment row-state evidence without attachment state text", () => {
    const pre = workflowSnapshot({
      visibleContent: "Attach files File input",
      pageContent: "Attach files File input",
      elements: [],
    });
    const current = workflowSnapshot({
      visibleContent: "Files File Alpha.pdf Available",
      pageContent: "Files File Alpha.pdf Available",
      elements: [rowElement(642, "File Alpha.pdf Available")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.UPLOAD_FILE,
      args: { id: 557, url: "https://files.example.test/file-alpha.pdf" },
      result: 'Uploaded "File Alpha.pdf" (2048 bytes) to [557] file input',
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: expect.objectContaining({
            source: "attachment_row_state",
          }),
        }),
      ]),
    );
  });

});
