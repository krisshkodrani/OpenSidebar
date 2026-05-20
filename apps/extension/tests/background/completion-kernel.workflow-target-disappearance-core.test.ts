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

  test("accepts backup confirmation from named database disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Backup queue Database Alpha Back up Database Alpha Database Beta Back up Database Beta",
      pageContent:
        "Backup queue Database Alpha Back up Database Alpha Database Beta Back up Database Beta",
      elements: [
        actionButton(504, "Back up Database Alpha"),
        actionButton(505, "Back up Database Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Backup queue Database Beta Back up Database Beta",
      pageContent: "Backup queue Database Beta Back up Database Beta",
      elements: [actionButton(505, "Back up Database Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Back up Database Alpha.",
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
      summary: "Backed up Database Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "backup",
      targetLabel: "Database Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:backup:database-alpha",
        detail: expect.objectContaining({
          action: "backup",
          source: "target_disappearance",
          text: "Backed up target no longer visible: Database Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects backup target-disappearance evidence for the wrong requested database", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Backup queue Database Alpha Back up Database Alpha Database Beta Back up Database Beta",
      pageContent:
        "Backup queue Database Alpha Back up Database Alpha Database Beta Back up Database Beta",
      elements: [
        actionButton(504, "Back up Database Alpha"),
        actionButton(505, "Back up Database Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Backup queue Database Alpha Back up Database Alpha",
      pageContent: "Backup queue Database Alpha Back up Database Alpha",
      elements: [actionButton(504, "Back up Database Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Back up Database Alpha.",
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
      summary: "Backed up Database Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "backup",
      targetLabel: "Database Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:backup:database-beta",
        detail: expect.objectContaining({
          action: "backup",
          source: "target_disappearance",
          text: "Backed up target no longer visible: Database Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer backup confirmation while the named database remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Backup queue Database Alpha Back up Database Alpha",
      pageContent: "Backup queue Database Alpha Back up Database Alpha",
      elements: [actionButton(504, "Back up Database Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Backup queue Database Alpha Back up Database Alpha",
      pageContent: "Backup queue Database Alpha Back up Database Alpha",
      elements: [actionButton(504, "Back up Database Alpha")],
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

  test("does not infer backup confirmation from a generic backup button", () => {
    const genericBackupButton: TaggedElement = {
      tag: 504,
      tagName: "button",
      role: "button",
      text: "Back up",
      attributes: {
        id: "backup",
        "aria-label": "Back up",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Backup queue Database Alpha Back up",
      pageContent: "Backup queue Database Alpha Back up",
      elements: [genericBackupButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Backup queue",
      pageContent: "Backup queue",
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

  test("accepts reset confirmation from named credential disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Reset queue Password Alpha Reset Password Alpha Password Beta Reset Password Beta",
      pageContent:
        "Reset queue Password Alpha Reset Password Alpha Password Beta Reset Password Beta",
      elements: [
        actionButton(504, "Reset Password Alpha"),
        actionButton(505, "Reset Password Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Reset queue Password Beta Reset Password Beta",
      pageContent: "Reset queue Password Beta Reset Password Beta",
      elements: [actionButton(505, "Reset Password Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Reset Password Alpha.",
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
      summary: "Reset Password Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reset",
      targetLabel: "Password Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:reset:password-alpha",
        detail: expect.objectContaining({
          action: "reset",
          source: "target_disappearance",
          text: "Reset target no longer visible: Password Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects reset target-disappearance evidence for the wrong requested credential", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Reset queue Password Alpha Reset Password Alpha Password Beta Reset Password Beta",
      pageContent:
        "Reset queue Password Alpha Reset Password Alpha Password Beta Reset Password Beta",
      elements: [
        actionButton(504, "Reset Password Alpha"),
        actionButton(505, "Reset Password Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Reset queue Password Alpha Reset Password Alpha",
      pageContent: "Reset queue Password Alpha Reset Password Alpha",
      elements: [actionButton(504, "Reset Password Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Reset Password Alpha.",
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
      summary: "Reset Password Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reset",
      targetLabel: "Password Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:reset:password-beta",
        detail: expect.objectContaining({
          action: "reset",
          source: "target_disappearance",
          text: "Reset target no longer visible: Password Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer reset confirmation while the named credential remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Reset queue Password Alpha Reset Password Alpha",
      pageContent: "Reset queue Password Alpha Reset Password Alpha",
      elements: [actionButton(504, "Reset Password Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Reset queue Password Alpha Reset Password Alpha",
      pageContent: "Reset queue Password Alpha Reset Password Alpha",
      elements: [actionButton(504, "Reset Password Alpha")],
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

  test("does not infer reset confirmation from a generic reset button", () => {
    const genericResetButton: TaggedElement = {
      tag: 504,
      tagName: "button",
      role: "button",
      text: "Reset",
      attributes: {
        id: "reset",
        "aria-label": "Reset",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Reset queue Password Alpha Reset",
      pageContent: "Reset queue Password Alpha Reset",
      elements: [genericResetButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Reset queue",
      pageContent: "Reset queue",
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

  test("accepts install confirmation from named package disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Available packages Package Alpha Install Package Alpha Package Beta Install Package Beta",
      pageContent:
        "Available packages Package Alpha Install Package Alpha Package Beta Install Package Beta",
      elements: [
        actionButton(504, "Install Package Alpha"),
        actionButton(505, "Install Package Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Available packages Package Beta Install Package Beta",
      pageContent: "Available packages Package Beta Install Package Beta",
      elements: [actionButton(505, "Install Package Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Install Package Alpha.",
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
      summary: "Installed Package Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "install",
      targetLabel: "Package Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:install:package-alpha",
        detail: expect.objectContaining({
          action: "install",
          source: "target_disappearance",
          text: "Installed target no longer visible: Package Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects install target-disappearance evidence for the wrong requested package", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Available packages Package Alpha Install Package Alpha Package Beta Install Package Beta",
      pageContent:
        "Available packages Package Alpha Install Package Alpha Package Beta Install Package Beta",
      elements: [
        actionButton(504, "Install Package Alpha"),
        actionButton(505, "Install Package Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Available packages Package Alpha Install Package Alpha",
      pageContent: "Available packages Package Alpha Install Package Alpha",
      elements: [actionButton(504, "Install Package Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Install Package Alpha.",
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
      summary: "Installed Package Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "install",
      targetLabel: "Package Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:install:package-beta",
        detail: expect.objectContaining({
          action: "install",
          source: "target_disappearance",
          text: "Installed target no longer visible: Package Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer install confirmation while the named package remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Available packages Package Alpha Install Package Alpha",
      pageContent: "Available packages Package Alpha Install Package Alpha",
      elements: [actionButton(504, "Install Package Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Available packages Package Alpha Install Package Alpha",
      pageContent: "Available packages Package Alpha Install Package Alpha",
      elements: [actionButton(504, "Install Package Alpha")],
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

  test("does not infer install confirmation from a generic install button", () => {
    const genericInstallButton: TaggedElement = {
      tag: 504,
      tagName: "button",
      role: "button",
      text: "Install",
      attributes: {
        id: "install",
        "aria-label": "Install",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Available packages Package Alpha Install",
      pageContent: "Available packages Package Alpha Install",
      elements: [genericInstallButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Available packages",
      pageContent: "Available packages",
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

  test("accepts uninstall confirmation from named package disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Packages Package Alpha Uninstall Package Alpha Package Beta Uninstall Package Beta",
      pageContent:
        "Packages Package Alpha Uninstall Package Alpha Package Beta Uninstall Package Beta",
      elements: [
        actionButton(505, "Uninstall Package Alpha"),
        actionButton(506, "Uninstall Package Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Packages Package Beta Uninstall Package Beta",
      pageContent: "Packages Package Beta Uninstall Package Beta",
      elements: [actionButton(506, "Uninstall Package Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Uninstall Package Alpha.",
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
      summary: "Uninstalled Package Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "uninstall",
      targetLabel: "Package Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:uninstall:package-alpha",
        detail: expect.objectContaining({
          action: "uninstall",
          source: "target_disappearance",
          text: "Uninstalled target no longer visible: Package Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects uninstall target-disappearance evidence for the wrong requested package", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Packages Package Alpha Uninstall Package Alpha Package Beta Uninstall Package Beta",
      pageContent:
        "Packages Package Alpha Uninstall Package Alpha Package Beta Uninstall Package Beta",
      elements: [
        actionButton(505, "Uninstall Package Alpha"),
        actionButton(506, "Uninstall Package Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Packages Package Alpha Uninstall Package Alpha",
      pageContent: "Packages Package Alpha Uninstall Package Alpha",
      elements: [actionButton(505, "Uninstall Package Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Uninstall Package Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 506 },
      result: "Clicked element 506.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Uninstalled Package Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "uninstall",
      targetLabel: "Package Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:uninstall:package-beta",
        detail: expect.objectContaining({
          action: "uninstall",
          source: "target_disappearance",
          text: "Uninstalled target no longer visible: Package Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer uninstall confirmation while the named package remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Packages Package Alpha Uninstall Package Alpha",
      pageContent: "Packages Package Alpha Uninstall Package Alpha",
      elements: [actionButton(505, "Uninstall Package Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Packages Package Alpha Uninstall Package Alpha",
      pageContent: "Packages Package Alpha Uninstall Package Alpha",
      elements: [actionButton(505, "Uninstall Package Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 505 },
      result: "Clicked element 505.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer uninstall confirmation from a generic uninstall button", () => {
    const genericUninstallButton: TaggedElement = {
      tag: 505,
      tagName: "button",
      role: "button",
      text: "Uninstall",
      attributes: {
        id: "uninstall",
        "aria-label": "Uninstall",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Packages Package Alpha Uninstall",
      pageContent: "Packages Package Alpha Uninstall",
      elements: [genericUninstallButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Packages",
      pageContent: "Packages",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 505 },
      result: "Clicked element 505.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts attach confirmation from named attachment disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Available attachments File Alpha Attach File Alpha File Beta Attach File Beta",
      pageContent:
        "Available attachments File Alpha Attach File Alpha File Beta Attach File Beta",
      elements: [
        actionButton(506, "Attach File Alpha"),
        actionButton(507, "Attach File Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Available attachments File Beta Attach File Beta",
      pageContent: "Available attachments File Beta Attach File Beta",
      elements: [actionButton(507, "Attach File Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Attach File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 506 },
      result: "Clicked element 506.",
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
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:attach:file-alpha",
        detail: expect.objectContaining({
          action: "attach",
          source: "target_disappearance",
          text: "Attached target no longer visible: File Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects attach target-disappearance evidence for the wrong requested attachment", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Available attachments File Alpha Attach File Alpha File Beta Attach File Beta",
      pageContent:
        "Available attachments File Alpha Attach File Alpha File Beta Attach File Beta",
      elements: [
        actionButton(506, "Attach File Alpha"),
        actionButton(507, "Attach File Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Available attachments File Alpha Attach File Alpha",
      pageContent: "Available attachments File Alpha Attach File Alpha",
      elements: [actionButton(506, "Attach File Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Attach File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 507 },
      result: "Clicked element 507.",
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
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:attach:file-beta",
        detail: expect.objectContaining({
          action: "attach",
          source: "target_disappearance",
          text: "Attached target no longer visible: File Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer attach confirmation while the named attachment remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Available attachments File Alpha Attach File Alpha",
      pageContent: "Available attachments File Alpha Attach File Alpha",
      elements: [actionButton(506, "Attach File Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Available attachments File Alpha Attach File Alpha",
      pageContent: "Available attachments File Alpha Attach File Alpha",
      elements: [actionButton(506, "Attach File Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 506 },
      result: "Clicked element 506.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer attach confirmation from a generic attach button", () => {
    const genericAttachButton: TaggedElement = {
      tag: 506,
      tagName: "button",
      role: "button",
      text: "Attach",
      attributes: {
        id: "attach",
        "aria-label": "Attach",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Available attachments File Alpha Attach",
      pageContent: "Available attachments File Alpha Attach",
      elements: [genericAttachButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Available attachments",
      pageContent: "Available attachments",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 506 },
      result: "Clicked element 506.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts detach confirmation from named attachment disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Attachments File Alpha Detach File Alpha File Beta Detach File Beta",
      pageContent:
        "Attachments File Alpha Detach File Alpha File Beta Detach File Beta",
      elements: [
        actionButton(507, "Detach File Alpha"),
        actionButton(508, "Detach File Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Attachments File Beta Detach File Beta",
      pageContent: "Attachments File Beta Detach File Beta",
      elements: [actionButton(508, "Detach File Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Detach File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 507 },
      result: "Clicked element 507.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Detached File Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "detach",
      targetLabel: "File Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:detach:file-alpha",
        detail: expect.objectContaining({
          action: "detach",
          source: "target_disappearance",
          text: "Detached target no longer visible: File Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects detach target-disappearance evidence for the wrong requested attachment", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Attachments File Alpha Detach File Alpha File Beta Detach File Beta",
      pageContent:
        "Attachments File Alpha Detach File Alpha File Beta Detach File Beta",
      elements: [
        actionButton(507, "Detach File Alpha"),
        actionButton(508, "Detach File Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Attachments File Alpha Detach File Alpha",
      pageContent: "Attachments File Alpha Detach File Alpha",
      elements: [actionButton(507, "Detach File Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Detach File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 508 },
      result: "Clicked element 508.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Detached File Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "detach",
      targetLabel: "File Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:detach:file-beta",
        detail: expect.objectContaining({
          action: "detach",
          source: "target_disappearance",
          text: "Detached target no longer visible: File Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer detach confirmation while the named attachment remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Attachments File Alpha Detach File Alpha",
      pageContent: "Attachments File Alpha Detach File Alpha",
      elements: [actionButton(507, "Detach File Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Attachments File Alpha Detach File Alpha",
      pageContent: "Attachments File Alpha Detach File Alpha",
      elements: [actionButton(507, "Detach File Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 507 },
      result: "Clicked element 507.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer detach confirmation from a generic detach button", () => {
    const genericDetachButton: TaggedElement = {
      tag: 507,
      tagName: "button",
      role: "button",
      text: "Detach",
      attributes: {
        id: "detach",
        "aria-label": "Detach",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Attachments File Alpha Detach",
      pageContent: "Attachments File Alpha Detach",
      elements: [genericDetachButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Attachments",
      pageContent: "Attachments",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 507 },
      result: "Clicked element 507.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts unlink confirmation from named relationship disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Linked accounts Account Alpha Unlink Account Alpha Account Beta Unlink Account Beta",
      pageContent:
        "Linked accounts Account Alpha Unlink Account Alpha Account Beta Unlink Account Beta",
      elements: [
        actionButton(509, "Unlink Account Alpha"),
        actionButton(510, "Unlink Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Linked accounts Account Beta Unlink Account Beta",
      pageContent: "Linked accounts Account Beta Unlink Account Beta",
      elements: [actionButton(510, "Unlink Account Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unlink Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 509 },
      result: "Clicked element 509.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unlinked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unlink",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unlink:account-alpha",
        detail: expect.objectContaining({
          action: "unlink",
          source: "target_disappearance",
          text: "Unlinked target no longer visible: Account Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unlink target-disappearance evidence for the wrong requested relationship", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Linked accounts Account Alpha Unlink Account Alpha Account Beta Unlink Account Beta",
      pageContent:
        "Linked accounts Account Alpha Unlink Account Alpha Account Beta Unlink Account Beta",
      elements: [
        actionButton(509, "Unlink Account Alpha"),
        actionButton(510, "Unlink Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Linked accounts Account Alpha Unlink Account Alpha",
      pageContent: "Linked accounts Account Alpha Unlink Account Alpha",
      elements: [actionButton(509, "Unlink Account Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unlink Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 510 },
      result: "Clicked element 510.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unlinked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unlink",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unlink:account-beta",
        detail: expect.objectContaining({
          action: "unlink",
          source: "target_disappearance",
          text: "Unlinked target no longer visible: Account Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unlink confirmation while the named relationship remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Linked accounts Account Alpha Unlink Account Alpha",
      pageContent: "Linked accounts Account Alpha Unlink Account Alpha",
      elements: [actionButton(509, "Unlink Account Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Linked accounts Account Alpha Unlink Account Alpha",
      pageContent: "Linked accounts Account Alpha Unlink Account Alpha",
      elements: [actionButton(509, "Unlink Account Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 509 },
      result: "Clicked element 509.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unlink confirmation from a generic unlink button", () => {
    const genericUnlinkButton: TaggedElement = {
      tag: 509,
      tagName: "button",
      role: "button",
      text: "Unlink",
      attributes: {
        id: "unlink",
        "aria-label": "Unlink",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Linked accounts Account Alpha Unlink",
      pageContent: "Linked accounts Account Alpha Unlink",
      elements: [genericUnlinkButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Linked accounts",
      pageContent: "Linked accounts",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 509 },
      result: "Clicked element 509.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts link confirmation from named relationship disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unlinked accounts Account Alpha Link Account Alpha Account Beta Link Account Beta",
      pageContent:
        "Unlinked accounts Account Alpha Link Account Alpha Account Beta Link Account Beta",
      elements: [
        actionButton(511, "Link Account Alpha"),
        actionButton(512, "Link Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unlinked accounts Account Beta Link Account Beta",
      pageContent: "Unlinked accounts Account Beta Link Account Beta",
      elements: [actionButton(512, "Link Account Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Link Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 511 },
      result: "Clicked element 511.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Linked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "link",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:link:account-alpha",
        detail: expect.objectContaining({
          action: "link",
          source: "target_disappearance",
          text: "Linked target no longer visible: Account Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects link target-disappearance evidence for the wrong requested relationship", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unlinked accounts Account Alpha Link Account Alpha Account Beta Link Account Beta",
      pageContent:
        "Unlinked accounts Account Alpha Link Account Alpha Account Beta Link Account Beta",
      elements: [
        actionButton(511, "Link Account Alpha"),
        actionButton(512, "Link Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unlinked accounts Account Alpha Link Account Alpha",
      pageContent: "Unlinked accounts Account Alpha Link Account Alpha",
      elements: [actionButton(511, "Link Account Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Link Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 512 },
      result: "Clicked element 512.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Linked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "link",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:link:account-beta",
        detail: expect.objectContaining({
          action: "link",
          source: "target_disappearance",
          text: "Linked target no longer visible: Account Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer link confirmation while the named relationship remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Unlinked accounts Account Alpha Link Account Alpha",
      pageContent: "Unlinked accounts Account Alpha Link Account Alpha",
      elements: [actionButton(511, "Link Account Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Unlinked accounts Account Alpha Link Account Alpha",
      pageContent: "Unlinked accounts Account Alpha Link Account Alpha",
      elements: [actionButton(511, "Link Account Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 511 },
      result: "Clicked element 511.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer link confirmation from a generic link button", () => {
    const genericLinkButton: TaggedElement = {
      tag: 511,
      tagName: "button",
      role: "button",
      text: "Link",
      attributes: {
        id: "link",
        "aria-label": "Link",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unlinked accounts Account Alpha Link",
      pageContent: "Unlinked accounts Account Alpha Link",
      elements: [genericLinkButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unlinked accounts",
      pageContent: "Unlinked accounts",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 511 },
      result: "Clicked element 511.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

});
