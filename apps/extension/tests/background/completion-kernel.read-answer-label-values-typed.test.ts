import { describe, expect, test } from "vitest";
import "../setup";
import {
  deriveCompletionEvidenceFromSnapshot,
  evaluateCompletionContract,
  generateCompletionContract,
} from "../../src/background/agent/completion-kernel";
import type { DomSnapshot } from "../../src/types";

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
describe("completion kernel typed label-value read-answer", () => {
  test("accepts concise grounded email label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix Owner email: support@example.com Backup email: help@example.com",
      pageContent:
        "Support Matrix Owner email: support@example.com. Backup email: help@example.com. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the owner email?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "support@example.com",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "owner email",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling email label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix Owner email: support@example.com Backup email: help@example.com",
      pageContent:
        "Support Matrix Owner email: support@example.com. Backup email: help@example.com. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the owner email?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "help@example.com",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "owner email",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded url label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix Portal URL: https://portal.example.com/login Backup URL: https://backup.example.com/login",
      pageContent:
        "Support Matrix Portal URL: https://portal.example.com/login. Backup URL: https://backup.example.com/login. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the portal URL?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "https://portal.example.com/login",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "portal url",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling url label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix Portal URL: https://portal.example.com/login Backup URL: https://backup.example.com/login",
      pageContent:
        "Support Matrix Portal URL: https://portal.example.com/login. Backup URL: https://backup.example.com/login. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the portal URL?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "https://backup.example.com/login",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "portal url",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept arbitrary single-word label-value answer summaries", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent: "Support Matrix Escalation owner: Alice Team: Bob",
      pageContent:
        "Support Matrix Escalation owner: Alice. Team: Bob. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is the escalation owner?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Alice",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "escalation owner",
    });
    expect(decision.status).toBe("inconclusive");
  });


});
