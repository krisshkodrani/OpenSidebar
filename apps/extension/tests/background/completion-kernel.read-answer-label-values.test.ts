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

describe("completion kernel label-value read-answer", () => {
  test("accepts grounded label-value question without explicit page wording", () => {
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
      summary: "The SLA is four hours for urgent incidents.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      requiresGroundedPageEvidence: true,
      expectedAnswerLabel: "sla",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts grounded label-value question with common label modifiers", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix SLA: four hours Escalation owner: platform operations",
      pageContent:
        "Support Matrix SLA: four hours for urgent incidents. Escalation owner: platform operations. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the current SLA?",
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

  test("accepts concise grounded who-when-where label-value answer summaries", () => {
    const cases = [
      {
        request: "Who is the escalation owner?",
        visible: "Escalation owner: platform operations",
        label: "escalation owner",
        summary: "platform operations",
      },
      {
        request: "When is the maintenance window?",
        visible: "Maintenance window: Friday morning",
        label: "maintenance window",
        summary: "Friday morning",
      },
      {
        request: "Where is the data center?",
        visible: "Data center: Berlin Germany",
        label: "data center",
        summary: "Berlin Germany",
      },
    ];

    for (const scenario of cases) {
      const snap = workflowSnapshot({
        title: "Support Matrix",
        url: "https://example.test/support",
        visibleContent: `Support Matrix ${scenario.visible}`,
        pageContent:
          `Support Matrix ${scenario.visible}. ` +
          "The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
      });
      const generated = generateCompletionContract({
        userRequest: scenario.request,
        snapshot: snap,
      });
      const decision = evaluateCompletionContract({
        contract: generated?.contract,
        evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
        snapshot: snap,
        candidateSource: "model_done",
        summary: scenario.summary,
      });

      expect(generated?.contract).toMatchObject({
        kind: "read_answer",
        expectedAnswerLabel: scenario.label,
      });
      expect(decision.status).toBe("accepted");
    }
  });

  test("does not accept concise who label-value answer for explanatory boilerplate", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix Escalation owner is documented in this policy and related routing notes.",
      pageContent:
        "Support Matrix Escalation owner is documented in this policy and related routing notes. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, escalation routing, and manager review, but it does not state a final escalation owner value.",
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
      summary: "platform operations",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerLabel
        : undefined,
    ).toBeUndefined();
    expect(decision.status).toBe("inconclusive");
  });

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

  test("does not use label-is-value read-answer for explanatory boilerplate", () => {
    const generated = generateCompletionContract({
      userRequest: "What is the SLA?",
      snapshot: workflowSnapshot({
        title: "Support Matrix",
        url: "https://example.test/support",
        visibleContent:
          "Support Matrix The SLA is described in this policy and related escalation notes.",
        pageContent:
          "Support Matrix The SLA is described in this policy and related escalation notes. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, and manager review, but it does not state a final SLA value.",
      }),
    });

    expect(generated).toBeNull();
  });

  test("does not use label-dash-value read-answer for explanatory boilerplate", () => {
    const generated = generateCompletionContract({
      userRequest: "What is the SLA?",
      snapshot: workflowSnapshot({
        title: "Support Matrix",
        url: "https://example.test/support",
        visibleContent:
          "Support Matrix SLA - described in this policy and related escalation notes.",
        pageContent:
          "Support Matrix SLA - described in this policy and related escalation notes. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, and manager review, but it does not state a final SLA value.",
      }),
    });

    expect(generated).toBeNull();
  });

  test("does not use label-value read-answer for modifier-only questions", () => {
    const generated = generateCompletionContract({
      userRequest: "What is the current?",
      snapshot: workflowSnapshot({
        title: "Support Matrix",
        url: "https://example.test/support",
        visibleContent:
          "Support Matrix SLA: four hours Escalation owner: platform operations",
        pageContent:
          "Support Matrix SLA: four hours for urgent incidents. Escalation owner: platform operations. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, and manager review so operators can answer support policy questions from visible page evidence.",
      }),
    });

    expect(generated).toBeNull();
  });

  test("does not use label-value read-answer when the page has no value-like label", () => {
    const generated = generateCompletionContract({
      userRequest: "What is the SLA?",
      snapshot: workflowSnapshot({
        title: "Support Matrix",
        url: "https://example.test/support",
        visibleContent:
          "Support Matrix The SLA applies to urgent incidents and escalation policies.",
        pageContent:
          "Support Matrix The SLA applies to urgent incidents and escalation policies, but this page has no final target value. It explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, and manager review.",
      }),
    });

    expect(generated).toBeNull();
  });

});
