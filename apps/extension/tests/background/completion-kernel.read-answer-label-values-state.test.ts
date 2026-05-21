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

describe("completion kernel state label-value read-answer", () => {
  test("accepts concise grounded boolean label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Security Matrix",
      url: "https://example.test/security",
      visibleContent: "Security Matrix MFA enabled: Yes Password rotation: No",
      pageContent:
        "Security Matrix MFA enabled: Yes. Password rotation: No. The page explains access controls, session policy, device posture, authentication coverage, audit cadence, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer security policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Is MFA enabled?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Yes.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "mfa enabled",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept the wrong concise boolean label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Security Matrix",
      url: "https://example.test/security",
      visibleContent: "Security Matrix MFA enabled: No Password rotation: Yes",
      pageContent:
        "Security Matrix MFA enabled: No. Password rotation: Yes. The page explains access controls, session policy, device posture, authentication coverage, audit cadence, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer security policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Is MFA enabled?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Yes",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "mfa enabled",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not use boolean read-answer without visible label-value evidence", () => {
    const generated = generateCompletionContract({
      userRequest: "Is MFA enabled?",
      snapshot: workflowSnapshot({
        title: "Security Matrix",
        url: "https://example.test/security",
        visibleContent:
          "Security Matrix The access control policy describes multi-factor authentication and password rotation.",
        pageContent:
          "Security Matrix The access control policy describes multi-factor authentication and password rotation. The page explains access controls, session policy, device posture, authentication coverage, audit cadence, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review, but it does not state a final MFA enabled value.",
      }),
    });

    expect(generated).toBeNull();
  });

  test("accepts only the expected concise status label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Incident Matrix",
      url: "https://example.test/incidents",
      visibleContent:
        "Incident Matrix Incident status: Closed Approval state: Open",
      pageContent:
        "Incident Matrix Incident status: Closed. Approval state: Open. The page explains service coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer incident status questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the incident status?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Closed.",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Open",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "incident status",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("accepts only the expected concise priority label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Incident Matrix",
      url: "https://example.test/incidents",
      visibleContent:
        "Incident Matrix Incident priority: High Approval priority: Low",
      pageContent:
        "Incident Matrix Incident priority: High. Approval priority: Low. The page explains service coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer incident priority questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the incident priority?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "High.",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Low",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "incident priority",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

});
