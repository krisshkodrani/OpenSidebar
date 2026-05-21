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

describe("completion kernel delivery action-update workflow confirmation", () => {
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
});
