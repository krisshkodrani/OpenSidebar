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
describe("completion kernel spatial measured label-value read-answer", () => {
  test("accepts only the expected concise coordinate label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Location Matrix",
      url: "https://example.test/locations",
      visibleContent:
        "Location Matrix GPS coordinates: 37.7749, -122.4194 Backup coordinates: 40.7128, -74.0060",
      pageContent:
        "Location Matrix GPS coordinates: 37.7749, -122.4194. Backup coordinates: 40.7128, -74.0060. The page explains location ownership, geolocation policy, routing notes, audit timing, incident routing, maintenance coordination, site ownership, escalation routing, and manager review so operators can answer location questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What are the GPS coordinates?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "37.7749,-122.4194",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "40.7128,-74.0060",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "gps coordinates",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("accepts parenthesized coordinate label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Location Matrix",
      url: "https://example.test/locations",
      visibleContent:
        "Location Matrix Location coordinates: (51.5074, -0.1278) Backup coordinates: (48.8566, 2.3522)",
      pageContent:
        "Location Matrix Location coordinates: (51.5074, -0.1278). Backup coordinates: (48.8566, 2.3522). The page explains location ownership, geolocation policy, routing notes, audit timing, incident routing, maintenance coordination, site ownership, escalation routing, and manager review so operators can answer location questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What are the location coordinates?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "51.5074,-0.1278",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "location coordinates",
    });
    expect(accepted.status).toBe("accepted");
  });

  test("does not accept coordinate concise answers without a coordinate label", () => {
    const snap = workflowSnapshot({
      title: "Location Matrix",
      url: "https://example.test/locations",
      visibleContent:
        "Location Matrix Team code: 37.7749, -122.4194 Backup code: 40.7128, -74.0060",
      pageContent:
        "Location Matrix Team code: 37.7749, -122.4194. Backup code: 40.7128, -74.0060. The page explains location ownership, geolocation policy, routing notes, audit timing, incident routing, maintenance coordination, site ownership, escalation routing, and manager review so operators can answer location questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "37.7749, -122.4194",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise physical speed label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Route Matrix",
      url: "https://example.test/routes",
      visibleContent: "Route Matrix Cruise speed: 55 mph Backup speed: 60 mph",
      pageContent:
        "Route Matrix Cruise speed: 55 mph. Backup speed: 60 mph. The page explains route timing, travel policy, service limits, audit notes, incident routing, maintenance coordination, fleet ownership, escalation routing, and manager review so operators can answer route questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the cruise speed?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "55mph",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "60mph",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "cruise speed",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept physical speed concise answers without a speed label", () => {
    const snap = workflowSnapshot({
      title: "Route Matrix",
      url: "https://example.test/routes",
      visibleContent: "Route Matrix Team code: 55mph Backup code: 60mph",
      pageContent:
        "Route Matrix Team code: 55mph. Backup code: 60mph. The page explains route timing, travel policy, service limits, audit notes, incident routing, maintenance coordination, fleet ownership, escalation routing, and manager review so operators can answer route questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "55mph",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise area label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Facility Matrix",
      url: "https://example.test/facility",
      visibleContent:
        "Facility Matrix Room area: 250 sq ft Backup area: 300 sq ft",
      pageContent:
        "Facility Matrix Room area: 250 sq ft. Backup area: 300 sq ft. The page explains facility planning, floor space policy, service limits, audit notes, incident routing, maintenance coordination, site ownership, escalation routing, and manager review so operators can answer facility questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the room area?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "250sqft",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "300sqft",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "room area",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept area concise answers without an area label", () => {
    const snap = workflowSnapshot({
      title: "Facility Matrix",
      url: "https://example.test/facility",
      visibleContent: "Facility Matrix Team code: 250sqft Backup code: 300sqft",
      pageContent:
        "Facility Matrix Team code: 250sqft. Backup code: 300sqft. The page explains facility planning, floor space policy, service limits, audit notes, incident routing, maintenance coordination, site ownership, escalation routing, and manager review so operators can answer facility questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "250sqft",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });
});
