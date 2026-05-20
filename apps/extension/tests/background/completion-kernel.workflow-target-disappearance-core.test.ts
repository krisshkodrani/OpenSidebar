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

function deleteButton(tag: number, target: string): TaggedElement {
  const key = target.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    tag,
    tagName: "button",
    role: "button",
    text: `Delete ${target}`,
    attributes: {
      id: `delete-${key}`,
      "aria-label": `Delete ${target}`,
    },
    rect: { x: 500, y: tag * 20, width: 120, height: 32 },
    isVisible: true,
    isDisabled: false,
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

describe("completion kernel target-disappearance workflow confirmation core", () => {
  test("accepts delete confirmation from named target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Accounts Warehouse Alpha Delete Warehouse Alpha Warehouse Beta Delete Warehouse Beta",
      pageContent:
        "Accounts Warehouse Alpha Delete Warehouse Alpha Warehouse Beta Delete Warehouse Beta",
      elements: [
        deleteButton(501, "Warehouse Alpha"),
        deleteButton(502, "Warehouse Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Accounts Warehouse Beta Delete Warehouse Beta",
      pageContent: "Accounts Warehouse Beta Delete Warehouse Beta",
      elements: [deleteButton(502, "Warehouse Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Delete Warehouse Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 501 },
      result: "Clicked element 501.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Deleted Warehouse Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "delete",
      targetLabel: "Warehouse Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:delete:warehouse-alpha",
        detail: expect.objectContaining({
          action: "delete",
          source: "target_disappearance",
          text: "Deleted target no longer visible: Warehouse Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects delete target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Accounts Warehouse Alpha Delete Warehouse Alpha Warehouse Beta Delete Warehouse Beta",
      pageContent:
        "Accounts Warehouse Alpha Delete Warehouse Alpha Warehouse Beta Delete Warehouse Beta",
      elements: [
        deleteButton(501, "Warehouse Alpha"),
        deleteButton(502, "Warehouse Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Accounts Warehouse Alpha Delete Warehouse Alpha",
      pageContent: "Accounts Warehouse Alpha Delete Warehouse Alpha",
      elements: [deleteButton(501, "Warehouse Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Delete Warehouse Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 502 },
      result: "Clicked element 502.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Deleted Warehouse Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "delete",
      targetLabel: "Warehouse Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:delete:warehouse-beta",
        detail: expect.objectContaining({
          action: "delete",
          source: "target_disappearance",
          text: "Deleted target no longer visible: Warehouse Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer delete confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Accounts Warehouse Alpha Delete Warehouse Alpha",
      pageContent: "Accounts Warehouse Alpha Delete Warehouse Alpha",
      elements: [deleteButton(501, "Warehouse Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Accounts Warehouse Alpha Delete Warehouse Alpha",
      pageContent: "Accounts Warehouse Alpha Delete Warehouse Alpha",
      elements: [deleteButton(501, "Warehouse Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 501 },
      result: "Clicked element 501.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer delete confirmation from a generic delete button", () => {
    const genericDeleteButton: TaggedElement = {
      tag: 501,
      tagName: "button",
      role: "button",
      text: "Delete",
      attributes: {
        id: "delete",
        "aria-label": "Delete",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Accounts Warehouse Alpha Delete",
      pageContent: "Accounts Warehouse Alpha Delete",
      elements: [genericDeleteButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Accounts",
      pageContent: "Accounts",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 501 },
      result: "Clicked element 501.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts archive confirmation from named target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Reports Report Alpha Archive Report Alpha Report Beta Archive Report Beta",
      pageContent:
        "Reports Report Alpha Archive Report Alpha Report Beta Archive Report Beta",
      elements: [
        actionButton(503, "Archive Report Alpha"),
        actionButton(504, "Archive Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Reports Report Beta Archive Report Beta",
      pageContent: "Reports Report Beta Archive Report Beta",
      elements: [actionButton(504, "Archive Report Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Archive Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 503 },
      result: "Clicked element 503.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Archived Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "archive",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:archive:report-alpha",
        detail: expect.objectContaining({
          action: "archive",
          source: "target_disappearance",
          text: "Archived target no longer visible: Report Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects archive target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Reports Report Alpha Archive Report Alpha Report Beta Archive Report Beta",
      pageContent:
        "Reports Report Alpha Archive Report Alpha Report Beta Archive Report Beta",
      elements: [
        actionButton(503, "Archive Report Alpha"),
        actionButton(504, "Archive Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Reports Report Alpha Archive Report Alpha",
      pageContent: "Reports Report Alpha Archive Report Alpha",
      elements: [actionButton(503, "Archive Report Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Archive Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 504 },
      result: "Clicked element 504.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Archived Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "archive",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:archive:report-beta",
        detail: expect.objectContaining({
          action: "archive",
          source: "target_disappearance",
          text: "Archived target no longer visible: Report Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer archive confirmation from a generic archive button", () => {
    const genericArchiveButton: TaggedElement = {
      tag: 503,
      tagName: "button",
      role: "button",
      text: "Archive",
      attributes: {
        id: "archive",
        "aria-label": "Archive",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Reports Report Alpha Archive",
      pageContent: "Reports Report Alpha Archive",
      elements: [genericArchiveButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Reports",
      pageContent: "Reports",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 503 },
      result: "Clicked element 503.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts deploy confirmation from named release disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Deploy queue Release Alpha Deploy Release Alpha Release Beta Deploy Release Beta",
      pageContent:
        "Deploy queue Release Alpha Deploy Release Alpha Release Beta Deploy Release Beta",
      elements: [
        actionButton(504, "Deploy Release Alpha"),
        actionButton(505, "Deploy Release Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Deploy queue Release Beta Deploy Release Beta",
      pageContent: "Deploy queue Release Beta Deploy Release Beta",
      elements: [actionButton(505, "Deploy Release Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Deploy Release Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 504 },
      result: "Clicked element 504.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Deployed Release Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "deploy",
      targetLabel: "Release Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:deploy:release-alpha",
        detail: expect.objectContaining({
          action: "deploy",
          source: "target_disappearance",
          text: "Deployed target no longer visible: Release Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects deploy target-disappearance evidence for the wrong requested release", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Deploy queue Release Alpha Deploy Release Alpha Release Beta Deploy Release Beta",
      pageContent:
        "Deploy queue Release Alpha Deploy Release Alpha Release Beta Deploy Release Beta",
      elements: [
        actionButton(504, "Deploy Release Alpha"),
        actionButton(505, "Deploy Release Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Deploy queue Release Alpha Deploy Release Alpha",
      pageContent: "Deploy queue Release Alpha Deploy Release Alpha",
      elements: [actionButton(504, "Deploy Release Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Deploy Release Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 505 },
      result: "Clicked element 505.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Deployed Release Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "deploy",
      targetLabel: "Release Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:deploy:release-beta",
        detail: expect.objectContaining({
          action: "deploy",
          source: "target_disappearance",
          text: "Deployed target no longer visible: Release Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer deploy confirmation while the named release remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Deploy queue Release Alpha Deploy Release Alpha",
      pageContent: "Deploy queue Release Alpha Deploy Release Alpha",
      elements: [actionButton(504, "Deploy Release Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Deploy queue Release Alpha Deploy Release Alpha",
      pageContent: "Deploy queue Release Alpha Deploy Release Alpha",
      elements: [actionButton(504, "Deploy Release Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 504 },
      result: "Clicked element 504.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer deploy confirmation from a generic deploy button", () => {
    const genericDeployButton: TaggedElement = {
      tag: 504,
      tagName: "button",
      role: "button",
      text: "Deploy",
      attributes: {
        id: "deploy",
        "aria-label": "Deploy",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Deploy queue Release Alpha Deploy",
      pageContent: "Deploy queue Release Alpha Deploy",
      elements: [genericDeployButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Deploy queue",
      pageContent: "Deploy queue",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 504 },
      result: "Clicked element 504.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts grant confirmation from named role disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Available grants Role Alpha Grant Role Alpha Role Beta Grant Role Beta",
      pageContent:
        "Available grants Role Alpha Grant Role Alpha Role Beta Grant Role Beta",
      elements: [
        actionButton(504, "Grant Role Alpha"),
        actionButton(505, "Grant Role Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Available grants Role Beta Grant Role Beta",
      pageContent: "Available grants Role Beta Grant Role Beta",
      elements: [actionButton(505, "Grant Role Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Grant Role Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 504 },
      result: "Clicked element 504.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Granted Role Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "grant",
      targetLabel: "Role Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:grant:role-alpha",
        detail: expect.objectContaining({
          action: "grant",
          source: "target_disappearance",
          text: "Granted target no longer visible: Role Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects grant target-disappearance evidence for the wrong requested role", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Available grants Role Alpha Grant Role Alpha Role Beta Grant Role Beta",
      pageContent:
        "Available grants Role Alpha Grant Role Alpha Role Beta Grant Role Beta",
      elements: [
        actionButton(504, "Grant Role Alpha"),
        actionButton(505, "Grant Role Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Available grants Role Alpha Grant Role Alpha",
      pageContent: "Available grants Role Alpha Grant Role Alpha",
      elements: [actionButton(504, "Grant Role Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Grant Role Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 505 },
      result: "Clicked element 505.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Granted Role Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "grant",
      targetLabel: "Role Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:grant:role-beta",
        detail: expect.objectContaining({
          action: "grant",
          source: "target_disappearance",
          text: "Granted target no longer visible: Role Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer grant confirmation while the named role remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Available grants Role Alpha Grant Role Alpha",
      pageContent: "Available grants Role Alpha Grant Role Alpha",
      elements: [actionButton(504, "Grant Role Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Available grants Role Alpha Grant Role Alpha",
      pageContent: "Available grants Role Alpha Grant Role Alpha",
      elements: [actionButton(504, "Grant Role Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 504 },
      result: "Clicked element 504.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer grant confirmation from a generic grant button", () => {
    const genericGrantButton: TaggedElement = {
      tag: 504,
      tagName: "button",
      role: "button",
      text: "Grant",
      attributes: {
        id: "grant",
        "aria-label": "Grant",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Available grants Role Alpha Grant",
      pageContent: "Available grants Role Alpha Grant",
      elements: [genericGrantButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Available grants",
      pageContent: "Available grants",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 504 },
      result: "Clicked element 504.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
