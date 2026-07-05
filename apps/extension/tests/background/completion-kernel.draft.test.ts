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

function emptyMessageComposer(tag: number): TaggedElement {
  return {
    tag,
    tagName: "textarea",
    role: "textbox",
    text: "Enter your message",
    attributes: {
      id: "react-aria6875732328-rf-",
      "aria-label": "Enter your message",
      placeholder: "Enter your message",
    },
    rect: { x: 0, y: tag * 20, width: 360, height: 96 },
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

  test("accepts draft-only completion from a live composer value read", () => {
    const snap = draftSnapshot({
      title: "XING message thread",
      url: "https://www.xing.com/messaging/thread/123",
      visibleContent: "XING message thread Enter your message Send",
      pageContent: "XING message thread Enter your message Send",
      elements: [emptyMessageComposer(133), actionButton(134, "Send")],
    });
    const draftText =
      "Hallo Elisabeth,\n\nentschuldige bitte die spaete Antwort. Ich bin aktuell auf der Suche nach einer Stelle in meinem Berufsfeld.\n\nViele Gruesse\nKris";
    const generated = generateCompletionContract({
      userRequest:
        "Type a German apology message in the composer explaining sorry for not answering sooner and currently looking for a job in profession. Do NOT send, leave for user review.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_ELEMENT,
      args: { id: 133, attribute: "value" },
      result: `[133] <textarea> "Enter your message" value="${draftText}"`,
      preActionSnapshot: null,
      currentSnapshot: snap,
      turn: 9,
    });

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "Drafted the German apology message and left it unsent in the composer for review.",
    });

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "draft_state",
          confidence: "high",
          detail: expect.objectContaining({
            text: expect.stringContaining("Hallo Elisabeth"),
            submitted: false,
          }),
        }),
      ]),
    );
    expect(generated?.contract).toMatchObject({
      kind: "draft_only",
      requiresUnsent: true,
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts draft-only completion from active message field value evidence", () => {
    const snap = draftSnapshot({
      elements: [emptyMessageComposer(301), actionButton(302, "Send")],
    });
    const generated = generateCompletionContract({
      userRequest: "Draft a reply in the message composer and do not send it.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.TYPE_TEXT,
      args: {
        id: 301,
        text: "Hello, thanks for the update. I will review this today.",
      },
      result: "Typed text into element [301].",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 4,
    }).filter((event) => event.type === "field_value");

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Drafted the reply and left it unsent.",
    });

    expect(evidence).toEqual([
      expect.objectContaining({
        type: "field_value",
        detail: expect.objectContaining({
          value: expect.stringContaining("thanks for the update"),
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "accepted",
      reason:
        "Draft-only contract is satisfied by active unsent draft field evidence.",
    });
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
