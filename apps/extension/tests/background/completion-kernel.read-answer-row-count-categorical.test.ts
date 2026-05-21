import { describe, expect, test } from "vitest";
import "../setup";
import {
  deriveCompletionEvidenceFromSnapshot,
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

describe("completion kernel categorical row-count aggregate read-answer", () => {
  test("accepts categorical row-count read-answer from visible row elements", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha Status: Open Priority: High Ticket Beta Status: Closed Priority: Low Ticket Gamma Status: Open Priority: Medium",
      pageContent: "Ticket Queue",
      elements: [
        rowElement(811, "Ticket Alpha Status: Open Priority: High"),
        rowElement(812, "Ticket Beta Status: Closed Priority: Low"),
        rowElement(813, "Ticket Gamma Status: Open Priority: Medium"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "How many tickets have status Open?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2 tickets have status Open.",
    });
    const wrongCount = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "1 ticket has status Open.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "tickets rows where status equals open",
      expectedAnswerScope: "aggregate",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:aggregate:",
    );
    expect(wrongCount.status).toBe("inconclusive");
  });

  test("accepts implicit-status categorical row-count read-answer from visible row elements", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha Status: Open Priority: High Ticket Beta Status: Closed Priority: Low Ticket Gamma Status: Open Priority: Medium",
      pageContent: "Ticket Queue",
      elements: [
        rowElement(811, "Ticket Alpha Status: Open Priority: High"),
        rowElement(812, "Ticket Beta Status: Closed Priority: Low"),
        rowElement(813, "Ticket Gamma Status: Open Priority: Medium"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "How many tickets are open?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "tickets rows where status equals open",
      expectedAnswerScope: "aggregate",
    });
    expect(accepted.status).toBe("accepted");
  });

  test("accepts adjective-status categorical row-count read-answer from visible row elements", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha Status: Open Priority: High Ticket Beta Status: Closed Priority: Low Ticket Gamma Status: Open Priority: Medium",
      pageContent: "Ticket Queue",
      elements: [
        rowElement(811, "Ticket Alpha Status: Open Priority: High"),
        rowElement(812, "Ticket Beta Status: Closed Priority: Low"),
        rowElement(813, "Ticket Gamma Status: Open Priority: Medium"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "How many open tickets are listed?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2 open tickets are listed.",
    });
    const wrongCount = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "3 open tickets are listed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "tickets rows where status equals open",
      expectedAnswerScope: "aggregate",
    });
    expect(accepted.status).toBe("accepted");
    expect(wrongCount.status).toBe("inconclusive");
  });

  test("accepts categorical row-count read-answer from read_page line evidence", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha Priority: High Ticket Beta Priority: Low Ticket Gamma Priority: High",
      pageContent: "Ticket Queue",
      elements: [
        rowElement(811, "Ticket Alpha Priority: High"),
        rowElement(812, "Ticket Beta Priority: Low"),
        rowElement(813, "Ticket Gamma Priority: High"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "How many tickets have priority High?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nTicket Alpha Priority: High\nTicket Beta Priority: Low\nTicket Gamma Priority: High\nThe page compares ticket status, priority, severity, ownership, audit timing, and queue notes so operators can answer categorical visible row-count questions from row evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "There are 2 high-priority tickets.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "tickets rows where priority equals high",
      expectedAnswerScope: "aggregate",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:aggregate-text:",
    );
  });

  test("accepts zero categorical row-count read-answer from visible row evidence", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha Status: Closed Priority: Low Ticket Beta Status: Closed Priority: Medium",
      pageContent: "Ticket Queue",
      elements: [
        rowElement(811, "Ticket Alpha Status: Closed Priority: Low"),
        rowElement(812, "Ticket Beta Status: Closed Priority: Medium"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "How many tickets have status Open?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "0 tickets have status Open.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "tickets rows where status equals open",
      expectedAnswerScope: "aggregate",
    });
    expect(accepted.status).toBe("accepted");
  });

  test("does not generate categorical row-count read-answer from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Queue Ticket Alpha Status is Open Ticket Beta Status is Closed Ticket Gamma Status is Open",
      pageContent:
        "Ticket Queue Ticket Alpha Status is Open Ticket Beta Status is Closed Ticket Gamma Status is Open. The page compares ticket status, priority, severity, ownership, audit timing, and queue notes so operators can answer categorical visible row-count questions from row evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "How many tickets have status Open?",
      snapshot: snap,
    });

    expect(generated).toBeNull();
  });

  test("does not generate categorical row-count read-answer without matching row entities", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Case Alpha Status: Open Case Beta Status: Closed Case Gamma Status: Open",
      pageContent: "Ticket Queue",
      elements: [
        rowElement(811, "Case Alpha Status: Open"),
        rowElement(812, "Case Beta Status: Closed"),
        rowElement(813, "Case Gamma Status: Open"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "How many tickets have status Open?",
      snapshot: snap,
    });

    expect(generated).toBeNull();
  });

  test("does not generate adjective-status row-count read-answer without matching row entities", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Case Alpha Status: Open Case Beta Status: Closed Case Gamma Status: Open",
      pageContent: "Ticket Queue",
      elements: [
        rowElement(811, "Case Alpha Status: Open"),
        rowElement(812, "Case Beta Status: Closed"),
        rowElement(813, "Case Gamma Status: Open"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "How many open tickets are listed?",
      snapshot: snap,
    });

    expect(generated).toBeNull();
  });

});
