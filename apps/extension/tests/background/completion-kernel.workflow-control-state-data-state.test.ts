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

function stableActionButton(
  tag: number,
  label: string,
  id: string,
): TaggedElement {
  return {
    ...actionButton(tag, label),
    attributes: {
      id,
      "aria-label": label,
    },
  };
}

function dataStateActionButton(
  tag: number,
  label: string,
  state: string,
  id: string,
  attribute:
    | "data-state"
    | "data-selected"
    | "data-checked"
    | "data-pressed" = "data-state",
): TaggedElement {
  return {
    ...stableActionButton(tag, label, id),
    attributes: {
      id,
      "aria-label": label,
      [attribute]: state,
    },
  };
}

describe("completion kernel workflow control-state data-state confirmation", () => {
  test("accepts connect confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Integration Alpha Connect Integration Alpha",
      pageContent: "Integration Alpha Connect Integration Alpha",
      elements: [
        dataStateActionButton(
          650,
          "Connect Integration Alpha",
          "disconnected",
          "integration-alpha-connect",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Integration Alpha Connect Integration Alpha",
      pageContent: "Integration Alpha Connect Integration Alpha",
      elements: [
        dataStateActionButton(
          651,
          "Connect Integration Alpha",
          "connected",
          "integration-alpha-connect",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Connect Integration Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 650 },
      result: "Clicked element 650.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
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
        logicalKey:
          "workflow:confirmation:connect:control-state:integration-alpha-connect",
        detail: expect.objectContaining({
          action: "connect",
          source: "control_state_change",
          targetText: "Integration Alpha",
          text: "Control state changed to connected: Connect Integration Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts disconnect confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Integration Alpha Disconnect Integration Alpha",
      pageContent: "Integration Alpha Disconnect Integration Alpha",
      elements: [
        dataStateActionButton(
          652,
          "Disconnect Integration Alpha",
          "connected",
          "integration-alpha-connect",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Integration Alpha Disconnect Integration Alpha",
      pageContent: "Integration Alpha Disconnect Integration Alpha",
      elements: [
        dataStateActionButton(
          653,
          "Disconnect Integration Alpha",
          "disconnected",
          "integration-alpha-connect",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Disconnect Integration Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 652 },
      result: "Clicked element 652.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
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
        logicalKey:
          "workflow:confirmation:disconnect:control-state:integration-alpha-connect",
        detail: expect.objectContaining({
          action: "disconnect",
          source: "control_state_change",
          targetText: "Integration Alpha",
          text: "Control state changed to disconnected: Disconnect Integration Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer connect confirmation when data-state was already connected", () => {
    const pre = workflowSnapshot({
      visibleContent: "Integration Alpha Connect Integration Alpha",
      pageContent: "Integration Alpha Connect Integration Alpha",
      elements: [
        dataStateActionButton(
          650,
          "Connect Integration Alpha",
          "connected",
          "integration-alpha-connect",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Integration Alpha Connect Integration Alpha",
      pageContent: "Integration Alpha Connect Integration Alpha",
      elements: [
        dataStateActionButton(
          651,
          "Connect Integration Alpha",
          "connected",
          "integration-alpha-connect",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 650 },
      result: "Clicked element 650.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer disconnect confirmation when data-state flips on", () => {
    const pre = workflowSnapshot({
      visibleContent: "Integration Alpha Disconnect Integration Alpha",
      pageContent: "Integration Alpha Disconnect Integration Alpha",
      elements: [
        dataStateActionButton(
          652,
          "Disconnect Integration Alpha",
          "disconnected",
          "integration-alpha-connect",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Integration Alpha Disconnect Integration Alpha",
      pageContent: "Integration Alpha Disconnect Integration Alpha",
      elements: [
        dataStateActionButton(
          653,
          "Disconnect Integration Alpha",
          "connected",
          "integration-alpha-connect",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 652 },
      result: "Clicked element 652.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts install confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Package Alpha Install Package Alpha",
      pageContent: "Package Alpha Install Package Alpha",
      elements: [
        dataStateActionButton(
          654,
          "Install Package Alpha",
          "uninstalled",
          "package-alpha-install",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Package Alpha Install Package Alpha",
      pageContent: "Package Alpha Install Package Alpha",
      elements: [
        dataStateActionButton(
          655,
          "Install Package Alpha",
          "installed",
          "package-alpha-install",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Install Package Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 654 },
      result: "Clicked element 654.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
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
        logicalKey:
          "workflow:confirmation:install:control-state:package-alpha-install",
        detail: expect.objectContaining({
          action: "install",
          source: "control_state_change",
          targetText: "Package Alpha",
          text: "Control state changed to installed: Install Package Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts uninstall confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Package Alpha Uninstall Package Alpha",
      pageContent: "Package Alpha Uninstall Package Alpha",
      elements: [
        dataStateActionButton(
          656,
          "Uninstall Package Alpha",
          "installed",
          "package-alpha-install",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Package Alpha Uninstall Package Alpha",
      pageContent: "Package Alpha Uninstall Package Alpha",
      elements: [
        dataStateActionButton(
          657,
          "Uninstall Package Alpha",
          "uninstalled",
          "package-alpha-install",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Uninstall Package Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 656 },
      result: "Clicked element 656.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
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
        logicalKey:
          "workflow:confirmation:uninstall:control-state:package-alpha-install",
        detail: expect.objectContaining({
          action: "uninstall",
          source: "control_state_change",
          targetText: "Package Alpha",
          text: "Control state changed to uninstalled: Uninstall Package Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer install confirmation when data-state was already installed", () => {
    const pre = workflowSnapshot({
      visibleContent: "Package Alpha Install Package Alpha",
      pageContent: "Package Alpha Install Package Alpha",
      elements: [
        dataStateActionButton(
          654,
          "Install Package Alpha",
          "installed",
          "package-alpha-install",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Package Alpha Install Package Alpha",
      pageContent: "Package Alpha Install Package Alpha",
      elements: [
        dataStateActionButton(
          655,
          "Install Package Alpha",
          "installed",
          "package-alpha-install",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 654 },
      result: "Clicked element 654.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer uninstall confirmation when data-state flips on", () => {
    const pre = workflowSnapshot({
      visibleContent: "Package Alpha Uninstall Package Alpha",
      pageContent: "Package Alpha Uninstall Package Alpha",
      elements: [
        dataStateActionButton(
          656,
          "Uninstall Package Alpha",
          "uninstalled",
          "package-alpha-install",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Package Alpha Uninstall Package Alpha",
      pageContent: "Package Alpha Uninstall Package Alpha",
      elements: [
        dataStateActionButton(
          657,
          "Uninstall Package Alpha",
          "installed",
          "package-alpha-install",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 656 },
      result: "Clicked element 656.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts sync confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Integration Alpha Sync Integration Alpha",
      pageContent: "Integration Alpha Sync Integration Alpha",
      elements: [
        dataStateActionButton(
          658,
          "Sync Integration Alpha",
          "unsynced",
          "integration-alpha-sync",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Integration Alpha Sync Integration Alpha",
      pageContent: "Integration Alpha Sync Integration Alpha",
      elements: [
        dataStateActionButton(
          659,
          "Sync Integration Alpha",
          "synced",
          "integration-alpha-sync",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Sync Integration Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 658 },
      result: "Clicked element 658.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
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
        logicalKey:
          "workflow:confirmation:sync:control-state:integration-alpha-sync",
        detail: expect.objectContaining({
          action: "sync",
          source: "control_state_change",
          targetText: "Integration Alpha",
          text: "Control state changed to synced: Sync Integration Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts resync confirmation from stale data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Integration Alpha Resync Integration Alpha",
      pageContent: "Integration Alpha Resync Integration Alpha",
      elements: [
        dataStateActionButton(
          660,
          "Resync Integration Alpha",
          "stale",
          "integration-alpha-sync",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Integration Alpha Resync Integration Alpha",
      pageContent: "Integration Alpha Resync Integration Alpha",
      elements: [
        dataStateActionButton(
          661,
          "Resync Integration Alpha",
          "synced",
          "integration-alpha-sync",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Resync Integration Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 660 },
      result: "Clicked element 660.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Resynced Integration Alpha.",
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
        logicalKey:
          "workflow:confirmation:sync:control-state:integration-alpha-sync",
        detail: expect.objectContaining({
          action: "sync",
          source: "control_state_change",
          targetText: "Integration Alpha",
          text: "Control state changed to synced: Resync Integration Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer sync confirmation when data-state was already synced", () => {
    const pre = workflowSnapshot({
      visibleContent: "Integration Alpha Sync Integration Alpha",
      pageContent: "Integration Alpha Sync Integration Alpha",
      elements: [
        dataStateActionButton(
          658,
          "Sync Integration Alpha",
          "synced",
          "integration-alpha-sync",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Integration Alpha Sync Integration Alpha",
      pageContent: "Integration Alpha Sync Integration Alpha",
      elements: [
        dataStateActionButton(
          659,
          "Sync Integration Alpha",
          "synced",
          "integration-alpha-sync",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 658 },
      result: "Clicked element 658.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer sync confirmation when data-state flips stale", () => {
    const pre = workflowSnapshot({
      visibleContent: "Integration Alpha Sync Integration Alpha",
      pageContent: "Integration Alpha Sync Integration Alpha",
      elements: [
        dataStateActionButton(
          658,
          "Sync Integration Alpha",
          "synced",
          "integration-alpha-sync",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Integration Alpha Sync Integration Alpha",
      pageContent: "Integration Alpha Sync Integration Alpha",
      elements: [
        dataStateActionButton(
          659,
          "Sync Integration Alpha",
          "stale",
          "integration-alpha-sync",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 658 },
      result: "Clicked element 658.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });
});
