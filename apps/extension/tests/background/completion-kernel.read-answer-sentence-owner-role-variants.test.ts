import { describe, expect, test } from "vitest";
import "../setup";
import {
  deriveCompletionEvidenceFromSnapshot,
  deriveCompletionEvidenceFromToolOutcome,
  evaluateCompletionContract,
  generateCompletionContract,
} from "../../src/background/agent/completion-kernel";
import { ToolName, type DomSnapshot } from "../../src/types";

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

describe("completion kernel sentence-scoped owner-role variant read-answer", () => {
  for (const scenario of [
    { name: "named-as", phrase: "is named as" },
    { name: "recorded-as", phrase: "is recorded as" },
    { name: "displayed-as", phrase: "is displayed as" },
  ]) {
    test(`accepts ${scenario.name} predicate-noun sentence-scoped owner answer for the requested target`, () => {
      const snap = workflowSnapshot({
        title: "Ticket Details",
        url: "https://example.test/tickets",
        visibleContent: `Maya Chen ${scenario.phrase} the owner of Ticket Alpha. Ravi Shah ${scenario.phrase} the owner of Ticket Beta.`,
        pageContent: `Maya Chen ${scenario.phrase} the owner of Ticket Alpha. Ravi Shah ${scenario.phrase} the owner of Ticket Beta. The page explains ticket ownership, ticket assignment, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.`,
      });
      const generated = generateCompletionContract({
        userRequest: "Who is the owner of Ticket Alpha?",
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
        expectedAnswerScope: "sentence",
      });
      expect(accepted.status).toBe("accepted");
      expect(siblingValue.status).toBe("inconclusive");
    });

    test(`does not use ${scenario.name} owner sentence-scoped acceptance from flattened page text`, () => {
      const snap = workflowSnapshot({
        title: "Ticket Queue",
        url: "https://example.test/tickets",
        visibleContent: `Ticket Queue Maya Chen ${scenario.phrase} the owner of Ticket Alpha Ravi Shah ${scenario.phrase} the owner of Ticket Beta`,
        pageContent: `Ticket Queue Maya Chen ${scenario.phrase} the owner of Ticket Alpha. Ravi Shah ${scenario.phrase} the owner of Ticket Beta. The page explains ticket ownership, ticket assignment, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.`,
        elements: [],
      });
      const generated = generateCompletionContract({
        userRequest: "Who is the owner of Ticket Alpha?",
        snapshot: snap,
      });
      const decision = evaluateCompletionContract({
        contract: generated?.contract,
        evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
        snapshot: snap,
        candidateSource: "model_done",
        summary: "Ticket Queue Maya Chen",
      });

      expect(
        generated?.contract.kind === "read_answer"
          ? generated.contract.expectedAnswerScope
          : undefined,
      ).toBeUndefined();
      expect(decision.status).not.toBe("accepted");
    });

    test(`accepts ${scenario.name} predicate-noun owner answer from read_page evidence without live snapshot`, () => {
      const snap = workflowSnapshot({
        title: "Ticket Details",
        url: "https://example.test/tickets",
        visibleContent: `Maya Chen ${scenario.phrase} the owner of Ticket Alpha. Ravi Shah ${scenario.phrase} the owner of Ticket Beta.`,
        pageContent: `Maya Chen ${scenario.phrase} the owner of Ticket Alpha. Ravi Shah ${scenario.phrase} the owner of Ticket Beta. The page explains ticket ownership, ticket assignment, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.`,
      });
      const generated = generateCompletionContract({
        userRequest: "Who is the owner of Ticket Alpha?",
        snapshot: snap,
      });
      const evidence = deriveCompletionEvidenceFromToolOutcome({
        toolName: ToolName.READ_PAGE,
        args: {},
        result: `Page content:\nMaya Chen ${scenario.phrase} the owner of Ticket Alpha. Ravi Shah ${scenario.phrase} the owner of Ticket Beta. The page explains ticket ownership, ticket assignment, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.`,
        preActionSnapshot: snap,
        currentSnapshot: snap,
        turn: 9,
      });
      const accepted = evaluateCompletionContract({
        contract: generated?.contract,
        evidence,
        candidateSource: "model_done",
        summary: "Maya Chen",
      });
      const siblingValue = evaluateCompletionContract({
        contract: generated?.contract,
        evidence,
        candidateSource: "model_done",
        summary: "Ravi Shah",
      });

      expect(generated?.contract).toMatchObject({
        kind: "read_answer",
        expectedAnswerLabel: "owner",
        expectedAnswerTarget: "Ticket Alpha",
        expectedAnswerScope: "sentence",
      });
      expect(accepted.status).toBe("accepted");
      expect(accepted.evidence[0]?.logicalKey).toContain(
        "read_answer:sentence-text:",
      );
      expect(siblingValue.status).toBe("inconclusive");
    });
  }

  for (const scenario of [
    { name: "acts-as", phrase: "acts as" },
    { name: "acting-as", phrase: "is acting as" },
    { name: "functions-as", phrase: "functions as" },
  ]) {
    test(`accepts ${scenario.name} predicate-noun sentence-scoped owner answer for the requested target`, () => {
      const snap = workflowSnapshot({
        title: "Ticket Details",
        url: "https://example.test/tickets",
        visibleContent: `Maya Chen ${scenario.phrase} the owner of Ticket Alpha. Ravi Shah ${scenario.phrase} the owner of Ticket Beta.`,
        pageContent: `Maya Chen ${scenario.phrase} the owner of Ticket Alpha. Ravi Shah ${scenario.phrase} the owner of Ticket Beta. The page explains ticket ownership, ticket assignment, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.`,
      });
      const generated = generateCompletionContract({
        userRequest: "Who is the owner of Ticket Alpha?",
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
        expectedAnswerScope: "sentence",
      });
      expect(accepted.status).toBe("accepted");
      expect(siblingValue.status).toBe("inconclusive");
    });

    test(`does not use ${scenario.name} owner sentence-scoped acceptance from flattened page text`, () => {
      const snap = workflowSnapshot({
        title: "Ticket Queue",
        url: "https://example.test/tickets",
        visibleContent: `Ticket Queue Maya Chen ${scenario.phrase} the owner of Ticket Alpha Ravi Shah ${scenario.phrase} the owner of Ticket Beta`,
        pageContent: `Ticket Queue Maya Chen ${scenario.phrase} the owner of Ticket Alpha. Ravi Shah ${scenario.phrase} the owner of Ticket Beta. The page explains ticket ownership, ticket assignment, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.`,
        elements: [],
      });
      const generated = generateCompletionContract({
        userRequest: "Who is the owner of Ticket Alpha?",
        snapshot: snap,
      });
      const decision = evaluateCompletionContract({
        contract: generated?.contract,
        evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
        snapshot: snap,
        candidateSource: "model_done",
        summary: "Ticket Queue Maya Chen",
      });

      expect(
        generated?.contract.kind === "read_answer"
          ? generated.contract.expectedAnswerScope
          : undefined,
      ).toBeUndefined();
      expect(decision.status).not.toBe("accepted");
    });

    test(`accepts ${scenario.name} predicate-noun owner answer from read_page evidence without live snapshot`, () => {
      const snap = workflowSnapshot({
        title: "Ticket Details",
        url: "https://example.test/tickets",
        visibleContent: `Maya Chen ${scenario.phrase} the owner of Ticket Alpha. Ravi Shah ${scenario.phrase} the owner of Ticket Beta.`,
        pageContent: `Maya Chen ${scenario.phrase} the owner of Ticket Alpha. Ravi Shah ${scenario.phrase} the owner of Ticket Beta. The page explains ticket ownership, ticket assignment, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.`,
      });
      const generated = generateCompletionContract({
        userRequest: "Who is the owner of Ticket Alpha?",
        snapshot: snap,
      });
      const evidence = deriveCompletionEvidenceFromToolOutcome({
        toolName: ToolName.READ_PAGE,
        args: {},
        result: `Page content:\nMaya Chen ${scenario.phrase} the owner of Ticket Alpha. Ravi Shah ${scenario.phrase} the owner of Ticket Beta. The page explains ticket ownership, ticket assignment, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.`,
        preActionSnapshot: snap,
        currentSnapshot: snap,
        turn: 9,
      });
      const accepted = evaluateCompletionContract({
        contract: generated?.contract,
        evidence,
        candidateSource: "model_done",
        summary: "Maya Chen",
      });
      const siblingValue = evaluateCompletionContract({
        contract: generated?.contract,
        evidence,
        candidateSource: "model_done",
        summary: "Ravi Shah",
      });

      expect(generated?.contract).toMatchObject({
        kind: "read_answer",
        expectedAnswerLabel: "owner",
        expectedAnswerTarget: "Ticket Alpha",
        expectedAnswerScope: "sentence",
      });
      expect(accepted.status).toBe("accepted");
      expect(accepted.evidence[0]?.logicalKey).toContain(
        "read_answer:sentence-text:",
      );
      expect(siblingValue.status).toBe("inconclusive");
    });
  }
});
