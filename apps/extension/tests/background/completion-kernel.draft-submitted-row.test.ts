import { describe, expect, test } from "vitest";
import "../setup";
import {
  deriveCompletionEvidenceFromToolOutcome,
  evaluateCompletionContract,
  generateCompletionContract,
} from "../../src/background/agent/completion-kernel";
import { ToolName, type DomSnapshot, type TaggedElement } from "../../src/types";

function textField(
  tag: number,
  label: string,
  value = "",
  type = "text",
): TaggedElement {
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    tag,
    tagName: "input",
    role: "textbox",
    text: value,
    attributes: {
      id: key,
      name: key,
      type,
      value,
      label,
    },
    rect: { x: 0, y: tag * 20, width: 180, height: 24 },
    isVisible: true,
    isDisabled: false,
  };
}

function draftSnapshot(overrides: Partial<DomSnapshot> = {}): DomSnapshot {
  return {
    title: "Email thread",
    url: "https://mail.example.test/thread/123",
    visibleContent: "Email thread Reply message",
    pageContent: "Email thread Reply message",
    elements: [
      {
        ...textField(
          301,
          "Reply message",
          "Hi David, Monday at 2 PM works for me.",
        ),
        tagName: "textarea",
        attributes: {
          id: "reply-message",
          name: "reply-message",
          label: "Reply message",
          value: "Hi David, Monday at 2 PM works for me.",
        },
      },
    ],
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

function rowElement(tag: number, text: string): TaggedElement {
  const key = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    tag,
    tagName: "tr",
    role: "row",
    text,
    attributes: {
      id: `row-${key}`,
    },
    rect: { x: 0, y: tag * 20, width: 600, height: 32 },
    isVisible: true,
    isDisabled: false,
  };
}

describe("completion kernel submitted draft row workflows", () => {
  test("accepts send confirmation from visible submitted draft row", () => {
    const draftText = "Hi David, Monday at 2 PM works for me.";
    const pre = draftSnapshot({
      visibleContent: `Email thread Reply message ${draftText} Send reply`,
      pageContent: `Email thread Reply message ${draftText} Send reply`,
      elements: [
        ...(draftSnapshot().elements ?? []),
        actionButton(302, "Send reply"),
      ],
    });
    const current = draftSnapshot({
      visibleContent: `Email thread Sent ${draftText}`,
      pageContent: `Email thread Sent ${draftText}`,
      elements: [
        {
          ...textField(301, "Reply message", ""),
          tagName: "textarea",
          attributes: {
            id: "reply-message",
            name: "reply-message",
            label: "Reply message",
            value: "",
          },
        },
        actionButton(302, "Send reply"),
        rowElement(640, `Sent ${draftText}`),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Send the reply.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 302 },
      result: "Clicked element 302.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 10,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Sent the reply.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "send",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:send:draft-row:reply-message",
        detail: expect.objectContaining({
          action: "send",
          source: "submitted_draft_row",
          targetText: draftText,
          text: "Sent draft visible as row: Reply message",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects submitted draft row evidence for the wrong requested target", () => {
    const draftText = "Beta rollout message: please review before Friday.";
    const pre = draftSnapshot({
      visibleContent: `Email thread Reply message ${draftText} Send reply`,
      pageContent: `Email thread Reply message ${draftText} Send reply`,
      elements: [
        {
          ...textField(301, "Reply message", draftText),
          tagName: "textarea",
          attributes: {
            id: "reply-message",
            name: "reply-message",
            label: "Reply message",
            value: draftText,
          },
        },
        actionButton(302, "Send reply"),
      ],
    });
    const current = draftSnapshot({
      visibleContent: `Email thread Sent ${draftText}`,
      pageContent: `Email thread Sent ${draftText}`,
      elements: [
        {
          ...textField(301, "Reply message", ""),
          tagName: "textarea",
          attributes: {
            id: "reply-message",
            name: "reply-message",
            label: "Reply message",
            value: "",
          },
        },
        actionButton(302, "Send reply"),
        rowElement(640, `Sent ${draftText}`),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Send the Alpha rollout message.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 302 },
      result: "Clicked element 302.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 10,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Sent the Alpha rollout message.",
    });

    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:send:draft-row:reply-message",
        detail: expect.objectContaining({
          action: "send",
          source: "submitted_draft_row",
          targetText: draftText,
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer submitted draft row while the editor still contains the draft", () => {
    const draftText = "Hi David, Monday at 2 PM works for me.";
    const pre = draftSnapshot({
      elements: [
        ...(draftSnapshot().elements ?? []),
        actionButton(302, "Send reply"),
      ],
    });
    const current = draftSnapshot({
      visibleContent: `Email thread Reply message ${draftText} Sent ${draftText}`,
      pageContent: `Email thread Reply message ${draftText} Sent ${draftText}`,
      elements: [
        ...(draftSnapshot().elements ?? []),
        actionButton(302, "Send reply"),
        rowElement(640, `Sent ${draftText}`),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 302 },
      result: "Clicked element 302.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 10,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer submitted draft row from a row that already existed", () => {
    const draftText = "Hi David, Monday at 2 PM works for me.";
    const pre = draftSnapshot({
      visibleContent: `Email thread Reply message ${draftText} Sent ${draftText} Send reply`,
      pageContent: `Email thread Reply message ${draftText} Sent ${draftText} Send reply`,
      elements: [
        ...(draftSnapshot().elements ?? []),
        actionButton(302, "Send reply"),
        rowElement(640, `Sent ${draftText}`),
      ],
    });
    const current = draftSnapshot({
      visibleContent: `Email thread Sent ${draftText}`,
      pageContent: `Email thread Sent ${draftText}`,
      elements: [
        {
          ...textField(301, "Reply message", ""),
          tagName: "textarea",
          attributes: {
            id: "reply-message",
            name: "reply-message",
            label: "Reply message",
            value: "",
          },
        },
        actionButton(302, "Send reply"),
        rowElement(640, `Sent ${draftText}`),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 302 },
      result: "Clicked element 302.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 10,
    });

    expect(evidence).toEqual([]);
  });
});
