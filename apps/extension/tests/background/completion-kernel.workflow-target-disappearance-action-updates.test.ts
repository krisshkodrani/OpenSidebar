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

describe("completion kernel action-update workflow confirmation", () => {
  test("accepts send confirmation from named queued message disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Queued messages Message Alpha Send Message Alpha Message Beta Send Message Beta",
      pageContent:
        "Queued messages Message Alpha Send Message Alpha Message Beta Send Message Beta",
      elements: [
        actionButton(571, "Send Message Alpha"),
        actionButton(572, "Send Message Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Queued messages Message Beta Send Message Beta",
      pageContent: "Queued messages Message Beta Send Message Beta",
      elements: [actionButton(572, "Send Message Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Send Message Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 571 },
      result: "Clicked element 571.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Sent Message Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "send",
      targetLabel: "Message Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:send:message-alpha",
        detail: expect.objectContaining({
          action: "send",
          source: "target_disappearance",
          text: "Sent target no longer visible: Message Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects send target-disappearance evidence for the wrong requested message", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Queued messages Message Alpha Send Message Alpha Message Beta Send Message Beta",
      pageContent:
        "Queued messages Message Alpha Send Message Alpha Message Beta Send Message Beta",
      elements: [
        actionButton(571, "Send Message Alpha"),
        actionButton(572, "Send Message Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Queued messages Message Alpha Send Message Alpha",
      pageContent: "Queued messages Message Alpha Send Message Alpha",
      elements: [actionButton(571, "Send Message Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Send Message Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 572 },
      result: "Clicked element 572.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Sent Message Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "send",
      targetLabel: "Message Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:send:message-beta",
        detail: expect.objectContaining({
          action: "send",
          source: "target_disappearance",
          text: "Sent target no longer visible: Message Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer send confirmation while the named queued message remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Queued messages Message Alpha Send Message Alpha",
      pageContent: "Queued messages Message Alpha Send Message Alpha",
      elements: [actionButton(571, "Send Message Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Queued messages Message Alpha Send Message Alpha",
      pageContent: "Queued messages Message Alpha Send Message Alpha",
      elements: [actionButton(571, "Send Message Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 571 },
      result: "Clicked element 571.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer send confirmation from a generic send message control", () => {
    const genericSendMessageButton: TaggedElement = {
      tag: 571,
      tagName: "button",
      role: "button",
      text: "Send message",
      attributes: {
        id: "send-message",
        "aria-label": "Send message",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Queued messages Message Alpha Send message",
      pageContent: "Queued messages Message Alpha Send message",
      elements: [genericSendMessageButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Queued messages",
      pageContent: "Queued messages",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 571 },
      result: "Clicked element 571.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts post confirmation from named draft article disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Draft articles Article Alpha Publish Article Alpha Article Beta Publish Article Beta",
      pageContent:
        "Draft articles Article Alpha Publish Article Alpha Article Beta Publish Article Beta",
      elements: [
        actionButton(573, "Publish Article Alpha"),
        actionButton(574, "Publish Article Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Draft articles Article Beta Publish Article Beta",
      pageContent: "Draft articles Article Beta Publish Article Beta",
      elements: [actionButton(574, "Publish Article Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Publish Article Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 573 },
      result: "Clicked element 573.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Published Article Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "post",
      targetLabel: "Article Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:post:article-alpha",
        detail: expect.objectContaining({
          action: "post",
          source: "target_disappearance",
          text: "Posted target no longer visible: Article Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects post target-disappearance evidence for the wrong requested article", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Draft articles Article Alpha Publish Article Alpha Article Beta Publish Article Beta",
      pageContent:
        "Draft articles Article Alpha Publish Article Alpha Article Beta Publish Article Beta",
      elements: [
        actionButton(573, "Publish Article Alpha"),
        actionButton(574, "Publish Article Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Draft articles Article Alpha Publish Article Alpha",
      pageContent: "Draft articles Article Alpha Publish Article Alpha",
      elements: [actionButton(573, "Publish Article Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Publish Article Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 574 },
      result: "Clicked element 574.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Published Article Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "post",
      targetLabel: "Article Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:post:article-beta",
        detail: expect.objectContaining({
          action: "post",
          source: "target_disappearance",
          text: "Posted target no longer visible: Article Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer post confirmation while the named draft article remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Draft articles Article Alpha Publish Article Alpha",
      pageContent: "Draft articles Article Alpha Publish Article Alpha",
      elements: [actionButton(573, "Publish Article Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Draft articles Article Alpha Publish Article Alpha",
      pageContent: "Draft articles Article Alpha Publish Article Alpha",
      elements: [actionButton(573, "Publish Article Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 573 },
      result: "Clicked element 573.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer post confirmation from a generic publish article control", () => {
    const genericPublishArticleButton: TaggedElement = {
      tag: 573,
      tagName: "button",
      role: "button",
      text: "Publish article",
      attributes: {
        id: "publish-article",
        "aria-label": "Publish article",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Draft articles Article Alpha Publish article",
      pageContent: "Draft articles Article Alpha Publish article",
      elements: [genericPublishArticleButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Draft articles",
      pageContent: "Draft articles",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 573 },
      result: "Clicked element 573.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts restart confirmation from named service disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Restart queue Service Alpha Restart Service Alpha Service Beta Restart Service Beta",
      pageContent:
        "Restart queue Service Alpha Restart Service Alpha Service Beta Restart Service Beta",
      elements: [
        actionButton(575, "Restart Service Alpha"),
        actionButton(576, "Restart Service Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Restart queue Service Beta Restart Service Beta",
      pageContent: "Restart queue Service Beta Restart Service Beta",
      elements: [actionButton(576, "Restart Service Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Restart Service Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 575 },
      result: "Clicked element 575.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Restarted Service Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "restart",
      targetLabel: "Service Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:restart:service-alpha",
        detail: expect.objectContaining({
          action: "restart",
          source: "target_disappearance",
          text: "Restarted target no longer visible: Service Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects restart target-disappearance evidence for the wrong requested service", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Restart queue Service Alpha Restart Service Alpha Service Beta Restart Service Beta",
      pageContent:
        "Restart queue Service Alpha Restart Service Alpha Service Beta Restart Service Beta",
      elements: [
        actionButton(575, "Restart Service Alpha"),
        actionButton(576, "Restart Service Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Restart queue Service Alpha Restart Service Alpha",
      pageContent: "Restart queue Service Alpha Restart Service Alpha",
      elements: [actionButton(575, "Restart Service Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Restart Service Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 576 },
      result: "Clicked element 576.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Restarted Service Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "restart",
      targetLabel: "Service Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:restart:service-beta",
        detail: expect.objectContaining({
          action: "restart",
          source: "target_disappearance",
          text: "Restarted target no longer visible: Service Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts refresh confirmation from named report disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Refresh queue Report Alpha Refresh Report Alpha Report Beta Refresh Report Beta",
      pageContent:
        "Refresh queue Report Alpha Refresh Report Alpha Report Beta Refresh Report Beta",
      elements: [
        actionButton(577, "Refresh Report Alpha"),
        actionButton(578, "Refresh Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Refresh queue Report Beta Refresh Report Beta",
      pageContent: "Refresh queue Report Beta Refresh Report Beta",
      elements: [actionButton(578, "Refresh Report Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Refresh Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 577 },
      result: "Clicked element 577.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Refreshed Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "refresh",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:refresh:report-alpha",
        detail: expect.objectContaining({
          action: "refresh",
          source: "target_disappearance",
          text: "Refreshed target no longer visible: Report Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer restart confirmation from a generic restart service control", () => {
    const genericRestartButton: TaggedElement = {
      tag: 575,
      tagName: "button",
      role: "button",
      text: "Restart service",
      attributes: {
        id: "restart-service",
        "aria-label": "Restart service",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Service Alpha Restart service",
      pageContent: "Service Alpha Restart service",
      elements: [genericRestartButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Services",
      pageContent: "Services",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 575 },
      result: "Clicked element 575.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer refresh confirmation from a browser page refresh control", () => {
    const pageRefreshButton: TaggedElement = {
      tag: 577,
      tagName: "button",
      role: "button",
      text: "Refresh page",
      attributes: {
        id: "refresh-page",
        "aria-label": "Refresh page",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Settings page Refresh page",
      pageContent: "Settings page Refresh page",
      elements: [pageRefreshButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Settings",
      pageContent: "Settings",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 577 },
      result: "Clicked element 577.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
  test("accepts save confirmation from named draft disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending drafts Draft Alpha Save Draft Alpha Draft Beta Save Draft Beta",
      pageContent:
        "Pending drafts Draft Alpha Save Draft Alpha Draft Beta Save Draft Beta",
      elements: [
        actionButton(551, "Save Draft Alpha"),
        actionButton(552, "Save Draft Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending drafts Draft Beta Save Draft Beta",
      pageContent: "Pending drafts Draft Beta Save Draft Beta",
      elements: [actionButton(552, "Save Draft Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Save Draft Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 551 },
      result: "Clicked element 551.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Saved Draft Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "save",
      targetLabel: "Draft Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:save:draft-alpha",
        detail: expect.objectContaining({
          action: "save",
          source: "target_disappearance",
          text: "Saved target no longer visible: Draft Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects save target-disappearance evidence for the wrong requested draft", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending drafts Draft Alpha Save Draft Alpha Draft Beta Save Draft Beta",
      pageContent:
        "Pending drafts Draft Alpha Save Draft Alpha Draft Beta Save Draft Beta",
      elements: [
        actionButton(551, "Save Draft Alpha"),
        actionButton(552, "Save Draft Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending drafts Draft Alpha Save Draft Alpha",
      pageContent: "Pending drafts Draft Alpha Save Draft Alpha",
      elements: [actionButton(551, "Save Draft Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Save Draft Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 552 },
      result: "Clicked element 552.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Saved Draft Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "save",
      targetLabel: "Draft Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:save:draft-beta",
        detail: expect.objectContaining({
          action: "save",
          source: "target_disappearance",
          text: "Saved target no longer visible: Draft Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer save confirmation while the named draft remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending drafts Draft Alpha Save Draft Alpha",
      pageContent: "Pending drafts Draft Alpha Save Draft Alpha",
      elements: [actionButton(551, "Save Draft Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending drafts Draft Alpha Save Draft Alpha",
      pageContent: "Pending drafts Draft Alpha Save Draft Alpha",
      elements: [actionButton(551, "Save Draft Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 551 },
      result: "Clicked element 551.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer save confirmation from a generic save draft control", () => {
    const genericSaveDraftButton: TaggedElement = {
      tag: 551,
      tagName: "button",
      role: "button",
      text: "Save draft",
      attributes: {
        id: "save-draft",
        "aria-label": "Save draft",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending drafts Draft Alpha Save draft",
      pageContent: "Pending drafts Draft Alpha Save draft",
      elements: [genericSaveDraftButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending drafts",
      pageContent: "Pending drafts",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 551 },
      result: "Clicked element 551.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts update confirmation from named package disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending updates Package Alpha Update Package Alpha Package Beta Update Package Beta",
      pageContent:
        "Pending updates Package Alpha Update Package Alpha Package Beta Update Package Beta",
      elements: [
        actionButton(549, "Update Package Alpha"),
        actionButton(550, "Update Package Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending updates Package Beta Update Package Beta",
      pageContent: "Pending updates Package Beta Update Package Beta",
      elements: [actionButton(550, "Update Package Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Update Package Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 549 },
      result: "Clicked element 549.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Updated Package Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "update",
      targetLabel: "Package Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:update:package-alpha",
        detail: expect.objectContaining({
          action: "update",
          source: "target_disappearance",
          text: "Updated target no longer visible: Package Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects update target-disappearance evidence for the wrong requested package", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending updates Package Alpha Update Package Alpha Package Beta Update Package Beta",
      pageContent:
        "Pending updates Package Alpha Update Package Alpha Package Beta Update Package Beta",
      elements: [
        actionButton(549, "Update Package Alpha"),
        actionButton(550, "Update Package Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending updates Package Alpha Update Package Alpha",
      pageContent: "Pending updates Package Alpha Update Package Alpha",
      elements: [actionButton(549, "Update Package Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Update Package Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 550 },
      result: "Clicked element 550.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Updated Package Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "update",
      targetLabel: "Package Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:update:package-beta",
        detail: expect.objectContaining({
          action: "update",
          source: "target_disappearance",
          text: "Updated target no longer visible: Package Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer update confirmation while the named package remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending updates Package Alpha Update Package Alpha",
      pageContent: "Pending updates Package Alpha Update Package Alpha",
      elements: [actionButton(549, "Update Package Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending updates Package Alpha Update Package Alpha",
      pageContent: "Pending updates Package Alpha Update Package Alpha",
      elements: [actionButton(549, "Update Package Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 549 },
      result: "Clicked element 549.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer update confirmation from a generic update package control", () => {
    const genericUpdatePackageButton: TaggedElement = {
      tag: 549,
      tagName: "button",
      role: "button",
      text: "Update package",
      attributes: {
        id: "update-package",
        "aria-label": "Update package",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending updates Package Alpha Update package",
      pageContent: "Pending updates Package Alpha Update package",
      elements: [genericUpdatePackageButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending updates",
      pageContent: "Pending updates",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 549 },
      result: "Clicked element 549.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
