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

describe("completion kernel target-disappearance object-change workflow confirmation", () => {
  test("accepts transfer confirmation from named case disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending transfers Case Alpha Transfer Case Alpha Case Beta Transfer Case Beta",
      pageContent:
        "Pending transfers Case Alpha Transfer Case Alpha Case Beta Transfer Case Beta",
      elements: [
        actionButton(523, "Transfer Case Alpha"),
        actionButton(524, "Transfer Case Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending transfers Case Beta Transfer Case Beta",
      pageContent: "Pending transfers Case Beta Transfer Case Beta",
      elements: [actionButton(524, "Transfer Case Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Transfer Case Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 523 },
      result: "Clicked element 523.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Transferred Case Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "transfer",
      targetLabel: "Case Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:transfer:case-alpha",
        detail: expect.objectContaining({
          action: "transfer",
          source: "target_disappearance",
          text: "Transferred target no longer visible: Case Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects transfer target-disappearance evidence for the wrong requested case", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending transfers Case Alpha Transfer Case Alpha Case Beta Transfer Case Beta",
      pageContent:
        "Pending transfers Case Alpha Transfer Case Alpha Case Beta Transfer Case Beta",
      elements: [
        actionButton(523, "Transfer Case Alpha"),
        actionButton(524, "Transfer Case Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending transfers Case Alpha Transfer Case Alpha",
      pageContent: "Pending transfers Case Alpha Transfer Case Alpha",
      elements: [actionButton(523, "Transfer Case Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Transfer Case Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 524 },
      result: "Clicked element 524.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Transferred Case Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "transfer",
      targetLabel: "Case Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:transfer:case-beta",
        detail: expect.objectContaining({
          action: "transfer",
          source: "target_disappearance",
          text: "Transferred target no longer visible: Case Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer transfer confirmation while the named case remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending transfers Case Alpha Transfer Case Alpha",
      pageContent: "Pending transfers Case Alpha Transfer Case Alpha",
      elements: [actionButton(523, "Transfer Case Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending transfers Case Alpha Transfer Case Alpha",
      pageContent: "Pending transfers Case Alpha Transfer Case Alpha",
      elements: [actionButton(523, "Transfer Case Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 523 },
      result: "Clicked element 523.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer transfer confirmation from a generic transfer button", () => {
    const genericTransferButton: TaggedElement = {
      tag: 523,
      tagName: "button",
      role: "button",
      text: "Transfer",
      attributes: {
        id: "transfer",
        "aria-label": "Transfer",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending transfers Case Alpha Transfer",
      pageContent: "Pending transfers Case Alpha Transfer",
      elements: [genericTransferButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending transfers",
      pageContent: "Pending transfers",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 523 },
      result: "Clicked element 523.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts move confirmation from named card disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending moves Card Alpha Move Card Alpha Card Beta Move Card Beta",
      pageContent:
        "Pending moves Card Alpha Move Card Alpha Card Beta Move Card Beta",
      elements: [
        actionButton(525, "Move Card Alpha"),
        actionButton(526, "Move Card Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending moves Card Beta Move Card Beta",
      pageContent: "Pending moves Card Beta Move Card Beta",
      elements: [actionButton(526, "Move Card Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Move Card Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 525 },
      result: "Clicked element 525.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Moved Card Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "move",
      targetLabel: "Card Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:move:card-alpha",
        detail: expect.objectContaining({
          action: "move",
          source: "target_disappearance",
          text: "Moved target no longer visible: Card Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects move target-disappearance evidence for the wrong requested card", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending moves Card Alpha Move Card Alpha Card Beta Move Card Beta",
      pageContent:
        "Pending moves Card Alpha Move Card Alpha Card Beta Move Card Beta",
      elements: [
        actionButton(525, "Move Card Alpha"),
        actionButton(526, "Move Card Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending moves Card Alpha Move Card Alpha",
      pageContent: "Pending moves Card Alpha Move Card Alpha",
      elements: [actionButton(525, "Move Card Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Move Card Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 526 },
      result: "Clicked element 526.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Moved Card Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "move",
      targetLabel: "Card Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:move:card-beta",
        detail: expect.objectContaining({
          action: "move",
          source: "target_disappearance",
          text: "Moved target no longer visible: Card Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer move confirmation while the named card remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending moves Card Alpha Move Card Alpha",
      pageContent: "Pending moves Card Alpha Move Card Alpha",
      elements: [actionButton(525, "Move Card Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending moves Card Alpha Move Card Alpha",
      pageContent: "Pending moves Card Alpha Move Card Alpha",
      elements: [actionButton(525, "Move Card Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 525 },
      result: "Clicked element 525.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer move confirmation from a generic move button", () => {
    const genericMoveButton: TaggedElement = {
      tag: 525,
      tagName: "button",
      role: "button",
      text: "Move",
      attributes: {
        id: "move",
        "aria-label": "Move",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending moves Card Alpha Move",
      pageContent: "Pending moves Card Alpha Move",
      elements: [genericMoveButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending moves",
      pageContent: "Pending moves",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 525 },
      result: "Clicked element 525.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts rename confirmation from named page disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending renames Page Alpha Rename Page Alpha Page Beta Rename Page Beta",
      pageContent:
        "Pending renames Page Alpha Rename Page Alpha Page Beta Rename Page Beta",
      elements: [
        actionButton(527, "Rename Page Alpha"),
        actionButton(528, "Rename Page Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending renames Page Beta Rename Page Beta",
      pageContent: "Pending renames Page Beta Rename Page Beta",
      elements: [actionButton(528, "Rename Page Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Rename Page Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 527 },
      result: "Clicked element 527.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Renamed Page Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "rename",
      targetLabel: "Page Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:rename:page-alpha",
        detail: expect.objectContaining({
          action: "rename",
          source: "target_disappearance",
          text: "Renamed target no longer visible: Page Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects rename target-disappearance evidence for the wrong requested page", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending renames Page Alpha Rename Page Alpha Page Beta Rename Page Beta",
      pageContent:
        "Pending renames Page Alpha Rename Page Alpha Page Beta Rename Page Beta",
      elements: [
        actionButton(527, "Rename Page Alpha"),
        actionButton(528, "Rename Page Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending renames Page Alpha Rename Page Alpha",
      pageContent: "Pending renames Page Alpha Rename Page Alpha",
      elements: [actionButton(527, "Rename Page Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Rename Page Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 528 },
      result: "Clicked element 528.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Renamed Page Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "rename",
      targetLabel: "Page Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:rename:page-beta",
        detail: expect.objectContaining({
          action: "rename",
          source: "target_disappearance",
          text: "Renamed target no longer visible: Page Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer rename confirmation while the named page remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending renames Page Alpha Rename Page Alpha",
      pageContent: "Pending renames Page Alpha Rename Page Alpha",
      elements: [actionButton(527, "Rename Page Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending renames Page Alpha Rename Page Alpha",
      pageContent: "Pending renames Page Alpha Rename Page Alpha",
      elements: [actionButton(527, "Rename Page Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 527 },
      result: "Clicked element 527.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer rename confirmation from a generic rename button", () => {
    const genericRenameButton: TaggedElement = {
      tag: 527,
      tagName: "button",
      role: "button",
      text: "Rename",
      attributes: {
        id: "rename",
        "aria-label": "Rename",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending renames Page Alpha Rename",
      pageContent: "Pending renames Page Alpha Rename",
      elements: [genericRenameButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending renames",
      pageContent: "Pending renames",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 527 },
      result: "Clicked element 527.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts merge confirmation from named ticket disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending merges Ticket Alpha Merge Ticket Alpha Ticket Beta Merge Ticket Beta",
      pageContent:
        "Pending merges Ticket Alpha Merge Ticket Alpha Ticket Beta Merge Ticket Beta",
      elements: [
        actionButton(529, "Merge Ticket Alpha"),
        actionButton(530, "Merge Ticket Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending merges Ticket Beta Merge Ticket Beta",
      pageContent: "Pending merges Ticket Beta Merge Ticket Beta",
      elements: [actionButton(530, "Merge Ticket Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Merge Ticket Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 529 },
      result: "Clicked element 529.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Merged Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "merge",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:merge:ticket-alpha",
        detail: expect.objectContaining({
          action: "merge",
          source: "target_disappearance",
          text: "Merged target no longer visible: Ticket Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects merge target-disappearance evidence for the wrong requested ticket", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending merges Ticket Alpha Merge Ticket Alpha Ticket Beta Merge Ticket Beta",
      pageContent:
        "Pending merges Ticket Alpha Merge Ticket Alpha Ticket Beta Merge Ticket Beta",
      elements: [
        actionButton(529, "Merge Ticket Alpha"),
        actionButton(530, "Merge Ticket Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending merges Ticket Alpha Merge Ticket Alpha",
      pageContent: "Pending merges Ticket Alpha Merge Ticket Alpha",
      elements: [actionButton(529, "Merge Ticket Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Merge Ticket Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 530 },
      result: "Clicked element 530.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Merged Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "merge",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:merge:ticket-beta",
        detail: expect.objectContaining({
          action: "merge",
          source: "target_disappearance",
          text: "Merged target no longer visible: Ticket Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer merge confirmation while the named ticket remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending merges Ticket Alpha Merge Ticket Alpha",
      pageContent: "Pending merges Ticket Alpha Merge Ticket Alpha",
      elements: [actionButton(529, "Merge Ticket Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending merges Ticket Alpha Merge Ticket Alpha",
      pageContent: "Pending merges Ticket Alpha Merge Ticket Alpha",
      elements: [actionButton(529, "Merge Ticket Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 529 },
      result: "Clicked element 529.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer merge confirmation from a generic merge button", () => {
    const genericMergeButton: TaggedElement = {
      tag: 529,
      tagName: "button",
      role: "button",
      text: "Merge",
      attributes: {
        id: "merge",
        "aria-label": "Merge",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending merges Ticket Alpha Merge",
      pageContent: "Pending merges Ticket Alpha Merge",
      elements: [genericMergeButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending merges",
      pageContent: "Pending merges",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 529 },
      result: "Clicked element 529.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});