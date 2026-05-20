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

describe("completion kernel target-disappearance connection workflow confirmation", () => {
  test("accepts disconnect confirmation from named connection disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Connected integrations Integration Alpha Disconnect Integration Alpha Integration Beta Disconnect Integration Beta",
      pageContent:
        "Connected integrations Integration Alpha Disconnect Integration Alpha Integration Beta Disconnect Integration Beta",
      elements: [
        actionButton(517, "Disconnect Integration Alpha"),
        actionButton(518, "Disconnect Integration Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Connected integrations Integration Beta Disconnect Integration Beta",
      pageContent:
        "Connected integrations Integration Beta Disconnect Integration Beta",
      elements: [actionButton(518, "Disconnect Integration Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Disconnect Integration Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 517 },
      result: "Clicked element 517.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Disconnected Integration Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "disconnect",
      targetLabel: "Integration Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:disconnect:integration-alpha",
        detail: expect.objectContaining({
          action: "disconnect",
          source: "target_disappearance",
          text: "Disconnected target no longer visible: Integration Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects disconnect target-disappearance evidence for the wrong requested connection", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Connected integrations Integration Alpha Disconnect Integration Alpha Integration Beta Disconnect Integration Beta",
      pageContent:
        "Connected integrations Integration Alpha Disconnect Integration Alpha Integration Beta Disconnect Integration Beta",
      elements: [
        actionButton(517, "Disconnect Integration Alpha"),
        actionButton(518, "Disconnect Integration Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Connected integrations Integration Alpha Disconnect Integration Alpha",
      pageContent:
        "Connected integrations Integration Alpha Disconnect Integration Alpha",
      elements: [actionButton(517, "Disconnect Integration Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Disconnect Integration Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 518 },
      result: "Clicked element 518.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Disconnected Integration Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "disconnect",
      targetLabel: "Integration Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:disconnect:integration-beta",
        detail: expect.objectContaining({
          action: "disconnect",
          source: "target_disappearance",
          text: "Disconnected target no longer visible: Integration Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer disconnect confirmation while the named connection remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Connected integrations Integration Alpha Disconnect Integration Alpha",
      pageContent:
        "Connected integrations Integration Alpha Disconnect Integration Alpha",
      elements: [actionButton(517, "Disconnect Integration Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Connected integrations Integration Alpha Disconnect Integration Alpha",
      pageContent:
        "Connected integrations Integration Alpha Disconnect Integration Alpha",
      elements: [actionButton(517, "Disconnect Integration Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 517 },
      result: "Clicked element 517.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer disconnect confirmation from a generic disconnect button", () => {
    const genericDisconnectButton: TaggedElement = {
      tag: 517,
      tagName: "button",
      role: "button",
      text: "Disconnect",
      attributes: {
        id: "disconnect",
        "aria-label": "Disconnect",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Connected integrations Integration Alpha Disconnect",
      pageContent: "Connected integrations Integration Alpha Disconnect",
      elements: [genericDisconnectButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Connected integrations",
      pageContent: "Connected integrations",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 517 },
      result: "Clicked element 517.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

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

  test("accepts sync confirmation from named integration disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending syncs Integration Alpha Sync Integration Alpha Integration Beta Sync Integration Beta",
      pageContent:
        "Pending syncs Integration Alpha Sync Integration Alpha Integration Beta Sync Integration Beta",
      elements: [
        actionButton(521, "Sync Integration Alpha"),
        actionButton(522, "Sync Integration Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending syncs Integration Beta Sync Integration Beta",
      pageContent: "Pending syncs Integration Beta Sync Integration Beta",
      elements: [actionButton(522, "Sync Integration Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Sync Integration Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 521 },
      result: "Clicked element 521.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Synced Integration Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "sync",
      targetLabel: "Integration Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:sync:integration-alpha",
        detail: expect.objectContaining({
          action: "sync",
          source: "target_disappearance",
          text: "Synced target no longer visible: Integration Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects sync target-disappearance evidence for the wrong requested integration", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending syncs Integration Alpha Sync Integration Alpha Integration Beta Sync Integration Beta",
      pageContent:
        "Pending syncs Integration Alpha Sync Integration Alpha Integration Beta Sync Integration Beta",
      elements: [
        actionButton(521, "Sync Integration Alpha"),
        actionButton(522, "Sync Integration Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending syncs Integration Alpha Sync Integration Alpha",
      pageContent: "Pending syncs Integration Alpha Sync Integration Alpha",
      elements: [actionButton(521, "Sync Integration Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Sync Integration Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 522 },
      result: "Clicked element 522.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Synced Integration Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "sync",
      targetLabel: "Integration Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:sync:integration-beta",
        detail: expect.objectContaining({
          action: "sync",
          source: "target_disappearance",
          text: "Synced target no longer visible: Integration Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer sync confirmation while the named integration remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending syncs Integration Alpha Sync Integration Alpha",
      pageContent: "Pending syncs Integration Alpha Sync Integration Alpha",
      elements: [actionButton(521, "Sync Integration Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending syncs Integration Alpha Sync Integration Alpha",
      pageContent: "Pending syncs Integration Alpha Sync Integration Alpha",
      elements: [actionButton(521, "Sync Integration Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 521 },
      result: "Clicked element 521.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer sync confirmation from a generic sync button", () => {
    const genericSyncButton: TaggedElement = {
      tag: 521,
      tagName: "button",
      role: "button",
      text: "Sync",
      attributes: {
        id: "sync",
        "aria-label": "Sync",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending syncs Integration Alpha Sync",
      pageContent: "Pending syncs Integration Alpha Sync",
      elements: [genericSyncButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending syncs",
      pageContent: "Pending syncs",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 521 },
      result: "Clicked element 521.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});