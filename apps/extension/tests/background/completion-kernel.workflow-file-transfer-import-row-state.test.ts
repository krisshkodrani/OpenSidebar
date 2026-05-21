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

describe("completion kernel file-transfer import row-state workflow confirmation", () => {
  test("accepts import confirmation from visible import row after upload_file", () => {
    const pre = workflowSnapshot({
      visibleContent: "Import data File input",
      pageContent: "Import data File input",
      elements: [],
    });
    const current = workflowSnapshot({
      visibleContent: "Imports File Alpha.csv Imported",
      pageContent: "Imports File Alpha.csv Imported",
      elements: [rowElement(642, "File Alpha.csv Imported")],
    });
    const generated = generateCompletionContract({
      userRequest: "Import File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.UPLOAD_FILE,
      args: { id: 557, url: "https://files.example.test/file-alpha.csv" },
      result: 'Uploaded "File Alpha.csv" (2048 bytes) to [557] file input',
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
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          confidence: "high",
          logicalKey: "workflow:confirmation:import:row:file-alpha-csv",
          detail: expect.objectContaining({
            action: "import",
            source: "import_row_state",
            targetText: "File Alpha.csv",
            text: "Import row visible: File Alpha.csv",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects import row-state evidence for the wrong requested file", () => {
    const pre = workflowSnapshot({
      visibleContent: "Import data File input",
      pageContent: "Import data File input",
      elements: [],
    });
    const current = workflowSnapshot({
      visibleContent: "Imports File Beta.csv Imported",
      pageContent: "Imports File Beta.csv Imported",
      elements: [rowElement(642, "File Beta.csv Imported")],
    });
    const generated = generateCompletionContract({
      userRequest: "Import File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.UPLOAD_FILE,
      args: { id: 557, url: "https://files.example.test/file-beta.csv" },
      result: 'Uploaded "File Beta.csv" (2048 bytes) to [557] file input',
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

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          confidence: "high",
          logicalKey: "workflow:confirmation:import:row:file-beta-csv",
          detail: expect.objectContaining({
            action: "import",
            source: "import_row_state",
            targetText: "File Beta.csv",
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

  test("does not infer import row-state evidence from plain visible text", () => {
    const pre = workflowSnapshot({
      visibleContent: "Import data File input",
      pageContent: "Import data File input",
      elements: [],
    });
    const current = workflowSnapshot({
      visibleContent: "Imports File Alpha.csv Imported",
      pageContent: "Imports File Alpha.csv Imported",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.UPLOAD_FILE,
      args: { id: 557, url: "https://files.example.test/file-alpha.csv" },
      result: 'Uploaded "File Alpha.csv" (2048 bytes) to [557] file input',
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: expect.objectContaining({
            source: "import_row_state",
          }),
        }),
      ]),
    );
  });

  test("does not infer import row-state evidence from a row that already existed", () => {
    const pre = workflowSnapshot({
      visibleContent: "Imports File Alpha.csv Imported",
      pageContent: "Imports File Alpha.csv Imported",
      elements: [rowElement(642, "File Alpha.csv Imported")],
    });
    const current = workflowSnapshot({
      visibleContent: "Imports File Alpha.csv Imported",
      pageContent: "Imports File Alpha.csv Imported",
      elements: [rowElement(642, "File Alpha.csv Imported")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.UPLOAD_FILE,
      args: { id: 557, url: "https://files.example.test/file-alpha.csv" },
      result: 'Uploaded "File Alpha.csv" (2048 bytes) to [557] file input',
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: expect.objectContaining({
            source: "import_row_state",
          }),
        }),
      ]),
    );
  });

  test("does not infer import row-state evidence without imported state text", () => {
    const pre = workflowSnapshot({
      visibleContent: "Import data File input",
      pageContent: "Import data File input",
      elements: [],
    });
    const current = workflowSnapshot({
      visibleContent: "Imports File Alpha.csv Available",
      pageContent: "Imports File Alpha.csv Available",
      elements: [rowElement(642, "File Alpha.csv Available")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.UPLOAD_FILE,
      args: { id: 557, url: "https://files.example.test/file-alpha.csv" },
      result: 'Uploaded "File Alpha.csv" (2048 bytes) to [557] file input',
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: expect.objectContaining({
            source: "import_row_state",
          }),
        }),
      ]),
    );
  });
});
