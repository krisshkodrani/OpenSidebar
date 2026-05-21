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

describe("completion kernel row-scoped read-answer", () => {
  test("accepts row-scoped label-value answer for the requested target row", () => {
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
      userRequest: "What is the status for Ticket Alpha?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Open",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "status",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "row",
    });
    expect(decision.status).toBe("accepted");
    expect(decision.evidence[0]?.logicalKey).toContain("read_answer:row:");
  });

  test("does not accept sibling row value for row-scoped label-value answer", () => {
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
      userRequest: "What is the status for Ticket Beta?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Open",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "status",
      expectedAnswerTarget: "Ticket Beta",
      expectedAnswerScope: "row",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts row-scoped possessive label-value question for the requested target row", () => {
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
      userRequest: "What is Ticket Alpha's status?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Open",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Closed",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "status",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "row",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts row-scoped linking-verb label question for the requested target row", () => {
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
      userRequest: "What status is Ticket Alpha?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Open",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Closed",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "status",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "row",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts row-scoped due-date question for the requested target row", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Queue Ticket Alpha Status: Open Due date: 2026-05-20 Ticket Beta Status: Closed Due date: 2026-05-21",
      pageContent:
        "Ticket Queue Ticket Alpha Status: Open Due date: 2026-05-20. Ticket Beta Status: Closed Due date: 2026-05-21. The page explains ticket status, ticket due dates, queue priority, customer impact, support routing, escalation notes, audit timing, and follow-up ownership so operators can answer ticket questions from visible row evidence.",
      elements: [
        rowElement(701, "Ticket Alpha Status: Open Due date: 2026-05-20"),
        rowElement(702, "Ticket Beta Status: Closed Due date: 2026-05-21"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "When is Ticket Alpha due?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2026-05-20",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2026-05-21",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "due date",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "row",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts row-scoped when possessive due-date question for the requested target row", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Queue Ticket Alpha Status: Open Due date: 2026-05-20 Ticket Beta Status: Closed Due date: 2026-05-21",
      pageContent:
        "Ticket Queue Ticket Alpha Status: Open Due date: 2026-05-20. Ticket Beta Status: Closed Due date: 2026-05-21. The page explains ticket status, ticket due dates, queue priority, customer impact, support routing, escalation notes, audit timing, and follow-up ownership so operators can answer ticket questions from visible row evidence.",
      elements: [
        rowElement(701, "Ticket Alpha Status: Open Due date: 2026-05-20"),
        rowElement(702, "Ticket Beta Status: Closed Due date: 2026-05-21"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "When is Ticket Alpha's due date?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2026-05-20",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2026-05-21",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "due date",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "row",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("does not use row-scoped read-answer acceptance from plain page text", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Queue Ticket Alpha Status: Open Ticket Beta Status: Closed",
      pageContent:
        "Ticket Queue Ticket Alpha Status: Open. Ticket Beta Status: Closed. The page explains ticket status, ticket ownership, queue priority, customer impact, support routing, escalation notes, audit timing, and follow-up ownership so operators can answer ticket questions from visible page evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "What is the status for Ticket Alpha?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Open",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("does not use row-scoped read-answer when the target row lacks a clear label value", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Queue Ticket Alpha status still being investigated Ticket Beta Status: Closed",
      pageContent:
        "Ticket Queue Ticket Alpha status still being investigated. Ticket Beta Status: Closed. The page explains ticket status, ticket ownership, queue priority, customer impact, support routing, escalation notes, audit timing, and follow-up ownership so operators can answer ticket questions from visible row evidence.",
      elements: [
        rowElement(701, "Ticket Alpha status still being investigated"),
        rowElement(702, "Ticket Beta Status: Closed"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "What is the status for Ticket Alpha?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Open",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });
});
