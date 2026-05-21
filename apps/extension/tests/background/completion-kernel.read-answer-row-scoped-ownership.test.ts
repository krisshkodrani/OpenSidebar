import { describe, expect, test } from "vitest";
import "../setup";
import {
  deriveCompletionEvidenceFromSnapshot,
  evaluateCompletionContract,
  generateCompletionContract,
} from "../../src/background/agent/completion-kernel";
import type { DomSnapshot, TaggedElement } from "../../src/types";

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

describe("completion kernel row-scoped ownership read-answer", () => {
  test("accepts row-scoped owner verb question for the requested target row", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Queue Ticket Alpha Status: Open Owner: Maya Chen Ticket Beta Status: Closed Owner: Ravi Shah",
      pageContent:
        "Ticket Queue Ticket Alpha Status: Open Owner: Maya Chen. Ticket Beta Status: Closed Owner: Ravi Shah. The page explains ticket status, ticket ownership, queue priority, customer impact, support routing, escalation notes, audit timing, and follow-up ownership so operators can answer ticket questions from visible row evidence.",
      elements: [
        rowElement(701, "Ticket Alpha Status: Open Owner: Maya Chen"),
        rowElement(702, "Ticket Beta Status: Closed Owner: Ravi Shah"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Who owns Ticket Alpha?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "owner",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "row",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts row-scoped owner question when the row label uses owned by", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Queue Ticket Alpha Status: Open Owned by: Maya Chen Ticket Beta Status: Closed Owned by: Ravi Shah",
      pageContent:
        "Ticket Queue Ticket Alpha Status: Open Owned by: Maya Chen. Ticket Beta Status: Closed Owned by: Ravi Shah. The page explains ticket status, ticket ownership, queue priority, customer impact, support routing, escalation notes, audit timing, and follow-up ownership so operators can answer ticket questions from visible row evidence.",
      elements: [
        rowElement(701, "Ticket Alpha Status: Open Owned by: Maya Chen"),
        rowElement(702, "Ticket Beta Status: Closed Owned by: Ravi Shah"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Who owns Ticket Alpha?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "owner",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "row",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts row-scoped passive assigned-to question for the requested target row", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Queue Ticket Alpha Status: Open Assigned to: Maya Chen Ticket Beta Status: Closed Assigned to: Ravi Shah",
      pageContent:
        "Ticket Queue Ticket Alpha Status: Open Assigned to: Maya Chen. Ticket Beta Status: Closed Assigned to: Ravi Shah. The page explains ticket status, ticket assignment, queue priority, customer impact, support routing, escalation notes, audit timing, and follow-up ownership so operators can answer ticket questions from visible row evidence.",
      elements: [
        rowElement(701, "Ticket Alpha Status: Open Assigned to: Maya Chen"),
        rowElement(702, "Ticket Beta Status: Closed Assigned to: Ravi Shah"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Ticket Alpha assigned to?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "assignee",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "row",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts row-scoped passive owned-by question for the requested target row", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Queue Ticket Alpha Status: Open Owned by: Maya Chen Ticket Beta Status: Closed Owned by: Ravi Shah",
      pageContent:
        "Ticket Queue Ticket Alpha Status: Open Owned by: Maya Chen. Ticket Beta Status: Closed Owned by: Ravi Shah. The page explains ticket status, ticket ownership, queue priority, customer impact, support routing, escalation notes, audit timing, and follow-up ownership so operators can answer ticket questions from visible row evidence.",
      elements: [
        rowElement(701, "Ticket Alpha Status: Open Owned by: Maya Chen"),
        rowElement(702, "Ticket Beta Status: Closed Owned by: Ravi Shah"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Ticket Alpha owned by?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "owner",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "row",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts row-scoped who possessive owner question for the requested target row", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Queue Ticket Alpha Status: Open Owner: Maya Chen Ticket Beta Status: Closed Owner: Ravi Shah",
      pageContent:
        "Ticket Queue Ticket Alpha Status: Open Owner: Maya Chen. Ticket Beta Status: Closed Owner: Ravi Shah. The page explains ticket status, ticket ownership, queue priority, customer impact, support routing, escalation notes, audit timing, and follow-up ownership so operators can answer ticket questions from visible row evidence.",
      elements: [
        rowElement(701, "Ticket Alpha Status: Open Owner: Maya Chen"),
        rowElement(702, "Ticket Beta Status: Closed Owner: Ravi Shah"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Ticket Alpha's owner?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "owner",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "row",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts row-scoped who possessive assignee question for the requested target row", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Queue Ticket Alpha Status: Open Assignee: Maya Chen Ticket Beta Status: Closed Assignee: Ravi Shah",
      pageContent:
        "Ticket Queue Ticket Alpha Status: Open Assignee: Maya Chen. Ticket Beta Status: Closed Assignee: Ravi Shah. The page explains ticket status, ticket assignment, queue priority, customer impact, support routing, escalation notes, audit timing, and follow-up ownership so operators can answer ticket questions from visible row evidence.",
      elements: [
        rowElement(701, "Ticket Alpha Status: Open Assignee: Maya Chen"),
        rowElement(702, "Ticket Beta Status: Closed Assignee: Ravi Shah"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Ticket Alpha's assignee?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "assignee",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "row",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts row-scoped assigned-to question for the requested target row", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Queue Ticket Alpha Status: Open Assignee: Maya Chen Ticket Beta Status: Closed Assignee: Ravi Shah",
      pageContent:
        "Ticket Queue Ticket Alpha Status: Open Assignee: Maya Chen. Ticket Beta Status: Closed Assignee: Ravi Shah. The page explains ticket status, ticket assignment, queue priority, customer impact, support routing, escalation notes, audit timing, and follow-up ownership so operators can answer ticket questions from visible row evidence.",
      elements: [
        rowElement(701, "Ticket Alpha Status: Open Assignee: Maya Chen"),
        rowElement(702, "Ticket Beta Status: Closed Assignee: Ravi Shah"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Who is assigned to Ticket Alpha?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "assignee",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "row",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts row-scoped assigned-to question when the row label uses assigned to", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Queue Ticket Alpha Status: Open Assigned to: Maya Chen Ticket Beta Status: Closed Assigned to: Ravi Shah",
      pageContent:
        "Ticket Queue Ticket Alpha Status: Open Assigned to: Maya Chen. Ticket Beta Status: Closed Assigned to: Ravi Shah. The page explains ticket status, ticket assignment, queue priority, customer impact, support routing, escalation notes, audit timing, and follow-up ownership so operators can answer ticket questions from visible row evidence.",
      elements: [
        rowElement(701, "Ticket Alpha Status: Open Assigned to: Maya Chen"),
        rowElement(702, "Ticket Beta Status: Closed Assigned to: Ravi Shah"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Who is assigned to Ticket Alpha?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "assignee",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "row",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });
});
