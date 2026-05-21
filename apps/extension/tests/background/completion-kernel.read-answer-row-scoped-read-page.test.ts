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

describe("completion kernel row-scoped read-answer from read_page", () => {
  test("accepts row-scoped label-value answer from read_page row text without live snapshot", () => {
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
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nTicket Alpha | Status: Open | Owner: Maya Chen\nTicket Beta | Status: Closed | Owner: Ravi Shah\nThe page explains ticket status, ticket ownership, queue priority, customer impact, support routing, escalation notes, audit timing, follow-up ownership, and support queue review so operators can answer ticket questions from visible row evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
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
    expect(decision.evidence[0]?.logicalKey).toContain("read_answer:row-text:");
  });

  test("does not accept sibling read_page row text for row-scoped label-value answer", () => {
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
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nTicket Alpha | Status: Open | Owner: Maya Chen\nTicket Beta | Status: Closed | Owner: Ravi Shah\nThe page explains ticket status, ticket ownership, queue priority, customer impact, support routing, escalation notes, audit timing, follow-up ownership, and support queue review so operators can answer ticket questions from visible row evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
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
});
