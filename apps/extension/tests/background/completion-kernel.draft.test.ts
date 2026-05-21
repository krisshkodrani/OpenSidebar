import { describe, expect, test } from "vitest";
import "../setup";
import {
  buildCompletionRecoveryHint,
  deriveCompletionEvidenceFromSnapshot,
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

describe("completion kernel draft workflows", () => {
  test("accepts send confirmation from draft disappearance", () => {
    const pre = draftSnapshot({
      visibleContent: "Email thread Reply message Send reply",
      pageContent: "Email thread Reply message Send reply",
      elements: [
        ...(draftSnapshot().elements ?? []),
        actionButton(302, "Send reply"),
      ],
    });
    const current = draftSnapshot({
      visibleContent: "Email thread",
      pageContent: "Email thread",
      elements: [actionButton(302, "Send reply")],
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
        logicalKey: "workflow:confirmation:send:draft:reply-message",
        detail: expect.objectContaining({
          action: "send",
          source: "draft_disappearance",
          text: "Sent draft no longer visible: Reply message",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer send confirmation while draft text remains visible", () => {
    const pre = draftSnapshot({
      elements: [
        ...(draftSnapshot().elements ?? []),
        actionButton(302, "Send reply"),
      ],
    });
    const current = draftSnapshot({
      elements: [
        ...(draftSnapshot().elements ?? []),
        actionButton(302, "Send reply"),
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

  test("does not infer draft submission from a generic submit button", () => {
    const pre = draftSnapshot({
      elements: [
        ...(draftSnapshot().elements ?? []),
        actionButton(302, "Submit"),
      ],
    });
    const current = draftSnapshot({
      visibleContent: "Email thread",
      pageContent: "Email thread",
      elements: [actionButton(302, "Submit")],
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

  test("accepts draft-only completion when an unsent draft is visible", () => {
    const snap = draftSnapshot();
    const generated = generateCompletionContract({
      userRequest:
        "Read David's email and draft a short reply in the reply box. Don't click send.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Drafted the reply and left it unsent in the editor.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "draft_only",
      requiresUnsent: true,
    });
    expect(decision.status).toBe("accepted");
    expect(decision.evidence).toEqual([
      expect.objectContaining({
        type: "draft_state",
        logicalKey: expect.stringContaining("draft:reply-message"),
      }),
    ]);
    expect(buildCompletionRecoveryHint(decision)).toContain("draft remains");
  });

  test("rejects draft-only completion when sent evidence is visible", () => {
    const snap = draftSnapshot({
      visibleContent: "Email thread Message sent",
      pageContent: "Email thread Message sent",
    });
    const generated = generateCompletionContract({
      userRequest:
        "Read David's email, draft a short reply, and leave it unsent.",
      snapshot: snap,
    });

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "The reply was sent.",
    });

    expect(generated?.contract).toMatchObject({ kind: "draft_only" });
    expect(decision.status).toBe("rejected");
    expect(decision.reason).toContain("sent");
  });

  test("generates draft-only contracts without a snapshot", () => {
    const generated = generateCompletionContract({
      userRequest: "Draft a reply to David and do not send it.",
      snapshot: null,
    });

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: [],
      snapshot: null,
      candidateSource: "model_done",
      summary: "The reply was sent.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "draft_only",
      requiresUnsent: true,
    });
    expect(decision.status).toBe("rejected");
    expect(decision.reason).toContain("sent");
  });

  test("does not treat unrelated draft wording as a draft-only contract", () => {
    const generated = generateCompletionContract({
      userRequest:
        "Read the project-updates channel to identify who should draft the changelog.",
      snapshot: draftSnapshot(),
    });

    expect(generated?.contract.kind).not.toBe("draft_only");
  });
});
