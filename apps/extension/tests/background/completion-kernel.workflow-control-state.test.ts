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

function statefulActionButton(
  tag: number,
  label: string,
  pressed: boolean,
  id: string,
): TaggedElement {
  return {
    ...stableActionButton(tag, label, id),
    attributes: {
      id,
      "aria-label": label,
      "aria-pressed": String(pressed),
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

describe("completion kernel workflow control-state confirmation", () => {
  test("accepts enable confirmation from control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Security settings Enable MFA",
      pageContent: "Security settings Enable MFA",
      elements: [statefulActionButton(620, "Enable MFA", false, "mfa-toggle")],
    });
    const current = workflowSnapshot({
      visibleContent: "Security settings Enable MFA",
      pageContent: "Security settings Enable MFA",
      elements: [statefulActionButton(621, "Enable MFA", true, "mfa-toggle")],
    });
    const generated = generateCompletionContract({
      userRequest: "Enable MFA.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 620 },
      result: "Clicked element 620.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Enabled MFA.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "enable",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:enable:control-state:mfa-toggle",
        detail: expect.objectContaining({
          action: "enable",
          source: "control_state_change",
          text: "Control state changed to enabled: Enable MFA",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware control-state confirmation for a different target", () => {
    const pre = workflowSnapshot({
      visibleContent: "Feature Alpha disabled Feature Beta disabled",
      pageContent: "Feature Alpha disabled Feature Beta disabled",
      elements: [
        statefulActionButton(
          640,
          "Enable Feature Beta",
          false,
          "feature-beta-toggle",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Feature Alpha disabled Feature Beta enabled",
      pageContent: "Feature Alpha disabled Feature Beta enabled",
      elements: [
        statefulActionButton(
          641,
          "Enable Feature Beta",
          true,
          "feature-beta-toggle",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Enable Feature Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 640 },
      result: "Clicked element 640.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Enabled Feature Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "enable",
      targetLabel: "Feature Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:enable:control-state:feature-beta-toggle",
        detail: expect.objectContaining({
          action: "enable",
          source: "control_state_change",
          targetText: "Feature Beta",
          text: "Control state changed to enabled: Enable Feature Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("keeps generic control-state confirmation valid for a named target", () => {
    const pre = workflowSnapshot({
      visibleContent: "Feature Alpha disabled",
      pageContent: "Feature Alpha disabled",
      elements: [statefulActionButton(640, "Enable", false, "feature-toggle")],
    });
    const current = workflowSnapshot({
      visibleContent: "Feature Alpha enabled",
      pageContent: "Feature Alpha enabled",
      elements: [statefulActionButton(641, "Enable", true, "feature-toggle")],
    });
    const generated = generateCompletionContract({
      userRequest: "Enable Feature Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 640 },
      result: "Clicked element 640.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Enabled Feature Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "enable",
      targetLabel: "Feature Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:enable:control-state:feature-toggle",
        detail: expect.objectContaining({
          action: "enable",
          source: "control_state_change",
          text: "Control state changed to enabled: Enable",
        }),
      }),
    ]);
    expect((evidence[0]?.detail as { targetText?: string }).targetText).toBe(
      undefined,
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts disable confirmation from control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Security settings Disable MFA",
      pageContent: "Security settings Disable MFA",
      elements: [statefulActionButton(622, "Disable MFA", true, "mfa-toggle")],
    });
    const current = workflowSnapshot({
      visibleContent: "Security settings Disable MFA",
      pageContent: "Security settings Disable MFA",
      elements: [statefulActionButton(623, "Disable MFA", false, "mfa-toggle")],
    });
    const generated = generateCompletionContract({
      userRequest: "Disable MFA.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 622 },
      result: "Clicked element 622.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Disabled MFA.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "disable",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:disable:control-state:mfa-toggle",
        detail: expect.objectContaining({
          action: "disable",
          source: "control_state_change",
          text: "Control state changed to disabled: Disable MFA",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

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

  test("accepts link confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Account Alpha Link Account Alpha",
      pageContent: "Account Alpha Link Account Alpha",
      elements: [
        dataStateActionButton(
          662,
          "Link Account Alpha",
          "unlinked",
          "account-alpha-link",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Account Alpha Link Account Alpha",
      pageContent: "Account Alpha Link Account Alpha",
      elements: [
        dataStateActionButton(
          663,
          "Link Account Alpha",
          "linked",
          "account-alpha-link",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Link Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 662 },
      result: "Clicked element 662.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
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
        logicalKey:
          "workflow:confirmation:link:control-state:account-alpha-link",
        detail: expect.objectContaining({
          action: "link",
          source: "control_state_change",
          targetText: "Account Alpha",
          text: "Control state changed to linked: Link Account Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts unlink confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Account Alpha Unlink Account Alpha",
      pageContent: "Account Alpha Unlink Account Alpha",
      elements: [
        dataStateActionButton(
          664,
          "Unlink Account Alpha",
          "linked",
          "account-alpha-link",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Account Alpha Unlink Account Alpha",
      pageContent: "Account Alpha Unlink Account Alpha",
      elements: [
        dataStateActionButton(
          665,
          "Unlink Account Alpha",
          "unlinked",
          "account-alpha-link",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Unlink Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 664 },
      result: "Clicked element 664.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
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
        logicalKey:
          "workflow:confirmation:unlink:control-state:account-alpha-link",
        detail: expect.objectContaining({
          action: "unlink",
          source: "control_state_change",
          targetText: "Account Alpha",
          text: "Control state changed to unlinked: Unlink Account Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer link confirmation when data-state was already linked", () => {
    const pre = workflowSnapshot({
      visibleContent: "Account Alpha Link Account Alpha",
      pageContent: "Account Alpha Link Account Alpha",
      elements: [
        dataStateActionButton(
          662,
          "Link Account Alpha",
          "linked",
          "account-alpha-link",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Account Alpha Link Account Alpha",
      pageContent: "Account Alpha Link Account Alpha",
      elements: [
        dataStateActionButton(
          663,
          "Link Account Alpha",
          "linked",
          "account-alpha-link",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 662 },
      result: "Clicked element 662.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unlink confirmation when data-state flips on", () => {
    const pre = workflowSnapshot({
      visibleContent: "Account Alpha Unlink Account Alpha",
      pageContent: "Account Alpha Unlink Account Alpha",
      elements: [
        dataStateActionButton(
          664,
          "Unlink Account Alpha",
          "unlinked",
          "account-alpha-link",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Account Alpha Unlink Account Alpha",
      pageContent: "Account Alpha Unlink Account Alpha",
      elements: [
        dataStateActionButton(
          665,
          "Unlink Account Alpha",
          "linked",
          "account-alpha-link",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 664 },
      result: "Clicked element 664.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts tag confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Record Alpha Tag Record Alpha",
      pageContent: "Record Alpha Tag Record Alpha",
      elements: [
        dataStateActionButton(
          666,
          "Tag Record Alpha",
          "untagged",
          "record-alpha-tag",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Record Alpha Tag Record Alpha",
      pageContent: "Record Alpha Tag Record Alpha",
      elements: [
        dataStateActionButton(
          667,
          "Tag Record Alpha",
          "tagged",
          "record-alpha-tag",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Tag Record Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 666 },
      result: "Clicked element 666.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Tagged Record Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "tag",
      targetLabel: "Record Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:tag:control-state:record-alpha-tag",
        detail: expect.objectContaining({
          action: "tag",
          source: "control_state_change",
          targetText: "Record Alpha",
          text: "Control state changed to tagged: Tag Record Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts untag confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Record Alpha Untag Record Alpha",
      pageContent: "Record Alpha Untag Record Alpha",
      elements: [
        dataStateActionButton(
          668,
          "Untag Record Alpha",
          "tagged",
          "record-alpha-tag",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Record Alpha Untag Record Alpha",
      pageContent: "Record Alpha Untag Record Alpha",
      elements: [
        dataStateActionButton(
          669,
          "Untag Record Alpha",
          "untagged",
          "record-alpha-tag",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Untag Record Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 668 },
      result: "Clicked element 668.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Untagged Record Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "untag",
      targetLabel: "Record Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:untag:control-state:record-alpha-tag",
        detail: expect.objectContaining({
          action: "untag",
          source: "control_state_change",
          targetText: "Record Alpha",
          text: "Control state changed to untagged: Untag Record Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts flag confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Message Alpha Flag Message Alpha",
      pageContent: "Message Alpha Flag Message Alpha",
      elements: [
        dataStateActionButton(
          670,
          "Flag Message Alpha",
          "unflagged",
          "message-alpha-flag",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Message Alpha Flag Message Alpha",
      pageContent: "Message Alpha Flag Message Alpha",
      elements: [
        dataStateActionButton(
          671,
          "Flag Message Alpha",
          "flagged",
          "message-alpha-flag",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Flag Message Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 670 },
      result: "Clicked element 670.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Flagged Message Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "flag",
      targetLabel: "Message Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:flag:control-state:message-alpha-flag",
        detail: expect.objectContaining({
          action: "flag",
          source: "control_state_change",
          targetText: "Message Alpha",
          text: "Control state changed to flagged: Flag Message Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts unflag confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Message Alpha Unflag Message Alpha",
      pageContent: "Message Alpha Unflag Message Alpha",
      elements: [
        dataStateActionButton(
          672,
          "Unflag Message Alpha",
          "flagged",
          "message-alpha-flag",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Message Alpha Unflag Message Alpha",
      pageContent: "Message Alpha Unflag Message Alpha",
      elements: [
        dataStateActionButton(
          673,
          "Unflag Message Alpha",
          "unflagged",
          "message-alpha-flag",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Unflag Message Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 672 },
      result: "Clicked element 672.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unflagged Message Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unflag",
      targetLabel: "Message Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:unflag:control-state:message-alpha-flag",
        detail: expect.objectContaining({
          action: "unflag",
          source: "control_state_change",
          targetText: "Message Alpha",
          text: "Control state changed to unflagged: Unflag Message Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer tag confirmation when data-state was already tagged", () => {
    const pre = workflowSnapshot({
      visibleContent: "Record Alpha Tag Record Alpha",
      pageContent: "Record Alpha Tag Record Alpha",
      elements: [
        dataStateActionButton(
          666,
          "Tag Record Alpha",
          "tagged",
          "record-alpha-tag",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Record Alpha Tag Record Alpha",
      pageContent: "Record Alpha Tag Record Alpha",
      elements: [
        dataStateActionButton(
          667,
          "Tag Record Alpha",
          "tagged",
          "record-alpha-tag",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 666 },
      result: "Clicked element 666.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer untag confirmation when data-state flips on", () => {
    const pre = workflowSnapshot({
      visibleContent: "Record Alpha Untag Record Alpha",
      pageContent: "Record Alpha Untag Record Alpha",
      elements: [
        dataStateActionButton(
          668,
          "Untag Record Alpha",
          "untagged",
          "record-alpha-tag",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Record Alpha Untag Record Alpha",
      pageContent: "Record Alpha Untag Record Alpha",
      elements: [
        dataStateActionButton(
          669,
          "Untag Record Alpha",
          "tagged",
          "record-alpha-tag",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 668 },
      result: "Clicked element 668.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer flag confirmation when data-state was already flagged", () => {
    const pre = workflowSnapshot({
      visibleContent: "Message Alpha Flag Message Alpha",
      pageContent: "Message Alpha Flag Message Alpha",
      elements: [
        dataStateActionButton(
          670,
          "Flag Message Alpha",
          "flagged",
          "message-alpha-flag",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Message Alpha Flag Message Alpha",
      pageContent: "Message Alpha Flag Message Alpha",
      elements: [
        dataStateActionButton(
          671,
          "Flag Message Alpha",
          "flagged",
          "message-alpha-flag",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 670 },
      result: "Clicked element 670.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unflag confirmation when data-state flips on", () => {
    const pre = workflowSnapshot({
      visibleContent: "Message Alpha Unflag Message Alpha",
      pageContent: "Message Alpha Unflag Message Alpha",
      elements: [
        dataStateActionButton(
          672,
          "Unflag Message Alpha",
          "unflagged",
          "message-alpha-flag",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Message Alpha Unflag Message Alpha",
      pageContent: "Message Alpha Unflag Message Alpha",
      elements: [
        dataStateActionButton(
          673,
          "Unflag Message Alpha",
          "flagged",
          "message-alpha-flag",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 672 },
      result: "Clicked element 672.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  for (const scenario of [
    {
      action: "pause",
      completion: "paused",
      label: "Pause Job Alpha",
      request: "Pause Job Alpha.",
      summary: "Paused Job Alpha.",
      target: "Job Alpha",
      id: "job-alpha-pause",
      beforeState: "running",
      afterState: "paused",
    },
    {
      action: "resume",
      completion: "resumed",
      label: "Resume Job Alpha",
      request: "Resume Job Alpha.",
      summary: "Resumed Job Alpha.",
      target: "Job Alpha",
      id: "job-alpha-resume",
      beforeState: "paused",
      afterState: "running",
    },
    {
      action: "start",
      completion: "started",
      label: "Start Service Alpha",
      request: "Start Service Alpha.",
      summary: "Started Service Alpha.",
      target: "Service Alpha",
      id: "service-alpha-start",
      beforeState: "stopped",
      afterState: "running",
    },
    {
      action: "stop",
      completion: "stopped",
      label: "Stop Service Alpha",
      request: "Stop Service Alpha.",
      summary: "Stopped Service Alpha.",
      target: "Service Alpha",
      id: "service-alpha-stop",
      beforeState: "running",
      afterState: "stopped",
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from operational data-state control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            682,
            scenario.label,
            scenario.beforeState,
            scenario.id,
          ),
        ],
      });
      const current = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            683,
            scenario.label,
            scenario.afterState,
            scenario.id,
          ),
        ],
      });
      const generated = generateCompletionContract({
        userRequest: scenario.request,
        snapshot: current,
      });
      const evidence = deriveCompletionEvidenceFromToolOutcome({
        toolName: ToolName.CLICK_ELEMENT,
        args: { id: 682 },
        result: "Clicked element 682.",
        preActionSnapshot: pre,
        currentSnapshot: current,
        turn: 11,
      });
      const decision = evaluateCompletionContract({
        contract: generated?.contract,
        evidence,
        snapshot: current,
        candidateSource: "model_done",
        summary: scenario.summary,
      });

      expect(generated?.contract).toMatchObject({
        kind: "workflow_confirmation",
        action: scenario.action,
        targetLabel: scenario.target,
      });
      expect(evidence).toEqual([
        expect.objectContaining({
          type: "confirmation_state",
          confidence: "high",
          logicalKey: `workflow:confirmation:${scenario.action}:control-state:${scenario.id}`,
          detail: expect.objectContaining({
            action: scenario.action,
            source: "control_state_change",
            targetText: scenario.target,
            text: `Control state changed to ${scenario.completion}: ${scenario.label}`,
          }),
        }),
      ]);
      expect(decision.status).toBe("accepted");
    });
  }

  test("does not infer pause confirmation when operational data-state was already paused", () => {
    const pre = workflowSnapshot({
      visibleContent: "Job Alpha Pause Job Alpha",
      pageContent: "Job Alpha Pause Job Alpha",
      elements: [
        dataStateActionButton(
          684,
          "Pause Job Alpha",
          "paused",
          "job-alpha-pause",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Job Alpha Pause Job Alpha",
      pageContent: "Job Alpha Pause Job Alpha",
      elements: [
        dataStateActionButton(
          685,
          "Pause Job Alpha",
          "paused",
          "job-alpha-pause",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 684 },
      result: "Clicked element 684.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer resume confirmation when operational data-state flips to paused", () => {
    const pre = workflowSnapshot({
      visibleContent: "Job Alpha Resume Job Alpha",
      pageContent: "Job Alpha Resume Job Alpha",
      elements: [
        dataStateActionButton(
          686,
          "Resume Job Alpha",
          "running",
          "job-alpha-resume",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Job Alpha Resume Job Alpha",
      pageContent: "Job Alpha Resume Job Alpha",
      elements: [
        dataStateActionButton(
          687,
          "Resume Job Alpha",
          "paused",
          "job-alpha-resume",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 686 },
      result: "Clicked element 686.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer start confirmation when operational data-state was already running", () => {
    const pre = workflowSnapshot({
      visibleContent: "Service Alpha Start Service Alpha",
      pageContent: "Service Alpha Start Service Alpha",
      elements: [
        dataStateActionButton(
          688,
          "Start Service Alpha",
          "running",
          "service-alpha-start",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Service Alpha Start Service Alpha",
      pageContent: "Service Alpha Start Service Alpha",
      elements: [
        dataStateActionButton(
          689,
          "Start Service Alpha",
          "running",
          "service-alpha-start",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 688 },
      result: "Clicked element 688.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer stop confirmation when operational data-state flips to running", () => {
    const pre = workflowSnapshot({
      visibleContent: "Service Alpha Stop Service Alpha",
      pageContent: "Service Alpha Stop Service Alpha",
      elements: [
        dataStateActionButton(
          690,
          "Stop Service Alpha",
          "stopped",
          "service-alpha-stop",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Service Alpha Stop Service Alpha",
      pageContent: "Service Alpha Stop Service Alpha",
      elements: [
        dataStateActionButton(
          691,
          "Stop Service Alpha",
          "running",
          "service-alpha-stop",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 690 },
      result: "Clicked element 690.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  for (const scenario of [
    {
      action: "restart",
      completion: "restarted",
      label: "Restart Service Alpha",
      request: "Restart Service Alpha.",
      summary: "Restarted Service Alpha.",
      target: "Service Alpha",
      id: "service-alpha-restart",
      beforeState: "running",
      afterState: "restarted",
    },
    {
      action: "refresh",
      completion: "refreshed",
      label: "Refresh Report Alpha",
      request: "Refresh Report Alpha.",
      summary: "Refreshed Report Alpha.",
      target: "Report Alpha",
      id: "report-alpha-refresh",
      beforeState: "stale",
      afterState: "refreshed",
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from semantic operation data-state control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            764,
            scenario.label,
            scenario.beforeState,
            scenario.id,
          ),
        ],
      });
      const current = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            765,
            scenario.label,
            scenario.afterState,
            scenario.id,
          ),
        ],
      });
      const generated = generateCompletionContract({
        userRequest: scenario.request,
        snapshot: current,
      });
      const evidence = deriveCompletionEvidenceFromToolOutcome({
        toolName: ToolName.CLICK_ELEMENT,
        args: { id: 764 },
        result: "Clicked element 764.",
        preActionSnapshot: pre,
        currentSnapshot: current,
        turn: 11,
      });
      const decision = evaluateCompletionContract({
        contract: generated?.contract,
        evidence,
        snapshot: current,
        candidateSource: "model_done",
        summary: scenario.summary,
      });

      expect(generated?.contract).toMatchObject({
        kind: "workflow_confirmation",
        action: scenario.action,
        targetLabel: scenario.target,
      });
      expect(evidence).toEqual([
        expect.objectContaining({
          type: "confirmation_state",
          confidence: "high",
          logicalKey: `workflow:confirmation:${scenario.action}:control-state:${scenario.id}`,
          detail: expect.objectContaining({
            action: scenario.action,
            source: "control_state_change",
            targetText: scenario.target,
            text: `Control state changed to ${scenario.completion}: ${scenario.label}`,
          }),
        }),
      ]);
      expect(decision.status).toBe("accepted");
    });
  }

  test("does not infer restart confirmation when semantic data-state was already restarted", () => {
    const pre = workflowSnapshot({
      visibleContent: "Service Alpha Restart Service Alpha",
      pageContent: "Service Alpha Restart Service Alpha",
      elements: [
        dataStateActionButton(
          766,
          "Restart Service Alpha",
          "restarted",
          "service-alpha-restart",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Service Alpha Restart Service Alpha",
      pageContent: "Service Alpha Restart Service Alpha",
      elements: [
        dataStateActionButton(
          767,
          "Restart Service Alpha",
          "restarted",
          "service-alpha-restart",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 766 },
      result: "Clicked element 766.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer refresh confirmation when semantic data-state flips stale", () => {
    const pre = workflowSnapshot({
      visibleContent: "Report Alpha Refresh Report Alpha",
      pageContent: "Report Alpha Refresh Report Alpha",
      elements: [
        dataStateActionButton(
          768,
          "Refresh Report Alpha",
          "refreshed",
          "report-alpha-refresh",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Report Alpha Refresh Report Alpha",
      pageContent: "Report Alpha Refresh Report Alpha",
      elements: [
        dataStateActionButton(
          769,
          "Refresh Report Alpha",
          "stale",
          "report-alpha-refresh",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 768 },
      result: "Clicked element 768.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer lock confirmation when control state flips the wrong direction", () => {
    const pre = workflowSnapshot({
      visibleContent: "Security settings Lock account",
      pageContent: "Security settings Lock account",
      elements: [statefulActionButton(624, "Lock account", true, "account-lock")],
    });
    const current = workflowSnapshot({
      visibleContent: "Security settings Lock account",
      pageContent: "Security settings Lock account",
      elements: [statefulActionButton(625, "Lock account", false, "account-lock")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 624 },
      result: "Clicked element 624.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });
});
