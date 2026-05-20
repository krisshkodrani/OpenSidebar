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

describe("completion kernel target-disappearance package attachment and link workflow confirmation", () => {
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
