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

describe("completion kernel label-value read-answer summaries", () => {
  test("accepts exact short multi-word label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix Primary region: North America East Backup region: North America West",
      pageContent:
        "Support Matrix Primary region: North America East. Backup region: North America West. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Where is the primary region?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "North America East",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary region",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling multi-word label-value answer with same prefix", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix Primary region: North America East Backup region: North America West",
      pageContent:
        "Support Matrix Primary region: North America East. Backup region: North America West. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Where is the primary region?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "North America West",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary region",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept multi-word label-value answer inside a longer phrase", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix Primary region: North America East Backup region: North America West",
      pageContent:
        "Support Matrix Primary region: North America East. Backup region: North America West. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Where is the primary region?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "North America East Coast",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary region",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix SLA: four hours Escalation owner: platform operations",
      pageContent:
        "Support Matrix SLA: four hours for urgent incidents. Escalation owner: platform operations. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the SLA?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "SLA: four hours",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "sla",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts concise grounded label-is-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix SLA is four hours Escalation owner is platform operations",
      pageContent:
        "Support Matrix SLA is four hours for urgent incidents. Escalation owner is platform operations. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the SLA?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "SLA: four hours",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "sla",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts concise grounded label-dash-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix SLA - four hours Escalation owner - platform operations",
      pageContent:
        "Support Matrix SLA - four hours for urgent incidents. Escalation owner - platform operations. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the SLA?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "SLA: four hours",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "sla",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept another page value for a label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix SLA: four hours Escalation owner: platform operations",
      pageContent:
        "Support Matrix SLA: four hours for urgent incidents. Escalation owner: platform operations. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the SLA?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "platform operations",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "sla",
    });
    expect(decision.status).toBe("inconclusive");
  });
});
