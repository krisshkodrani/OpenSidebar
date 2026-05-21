import { describe, expect, test } from "vitest";
import "../setup";
import {
  deriveCompletionEvidenceFromToolOutcome,
  evaluateCompletionContract,
  generateCompletionContract,
} from "../../src/background/agent/completion-kernel";
import { ToolName, type DomSnapshot } from "../../src/types";

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

describe("completion kernel download result workflow confirmation", () => {
  test("accepts download confirmation from download_file result evidence", () => {
    const snap = workflowSnapshot({
      visibleContent: "Download center File Alpha File Beta",
      pageContent: "Download center File Alpha File Beta",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Download File Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.DOWNLOAD_FILE,
      args: {
        url: "https://files.example.test/file-alpha.pdf",
        filename: "File Alpha.pdf",
      },
      result: "Download started (ID: 42)",
      currentSnapshot: snap,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
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
        logicalKey: "workflow:confirmation:download:file-alpha-pdf",
        detail: expect.objectContaining({
          action: "download",
          source: "download_file_result",
          targetText: "File Alpha.pdf",
          text: "Download started: File Alpha.pdf (ID: 42)",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts download_file result evidence target from the URL filename", () => {
    const snap = workflowSnapshot({
      visibleContent: "Download center File Alpha",
      pageContent: "Download center File Alpha",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Download File Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.DOWNLOAD_FILE,
      args: { url: "https://files.example.test/downloads/File%20Alpha.pdf" },
      result: "Download started (ID: 43)",
      currentSnapshot: snap,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Downloaded File Alpha.",
    });

    expect(evidence).toEqual([
      expect.objectContaining({
        logicalKey: "workflow:confirmation:download:file-alpha-pdf",
        detail: expect.objectContaining({
          action: "download",
          source: "download_file_result",
          targetText: "File Alpha.pdf",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts completed download_file result evidence", () => {
    const snap = workflowSnapshot({
      visibleContent: "Download center File Alpha",
      pageContent: "Download center File Alpha",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Download File Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.DOWNLOAD_FILE,
      args: { url: "https://files.example.test/downloads/file-alpha.pdf" },
      result: "Download completed (ID: 45, filename: File Alpha.pdf)",
      currentSnapshot: snap,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Downloaded File Alpha.",
    });

    expect(evidence).toEqual([
      expect.objectContaining({
        logicalKey: "workflow:confirmation:download:file-alpha-pdf",
        detail: expect.objectContaining({
          action: "download",
          source: "download_file_completed",
          targetText: "File Alpha.pdf",
          text: "Download completed: File Alpha.pdf (ID: 45)",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects download_file result evidence for the wrong requested file", () => {
    const snap = workflowSnapshot({
      visibleContent: "Download center File Alpha File Beta",
      pageContent: "Download center File Alpha File Beta",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Download File Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.DOWNLOAD_FILE,
      args: {
        url: "https://files.example.test/file-beta.pdf",
        filename: "File Beta.pdf",
      },
      result: "Download started (ID: 44)",
      currentSnapshot: snap,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Downloaded File Alpha.",
    });

    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:download:file-beta-pdf",
        detail: expect.objectContaining({
          action: "download",
          source: "download_file_result",
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

  test("does not infer download_file result evidence from non-start result text", () => {
    const snap = workflowSnapshot({
      visibleContent: "Download center File Alpha",
      pageContent: "Download center File Alpha",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.DOWNLOAD_FILE,
      args: {
        url: "https://files.example.test/file-alpha.pdf",
        filename: "File Alpha.pdf",
      },
      result: "Error starting download: Network failed",
      currentSnapshot: snap,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
