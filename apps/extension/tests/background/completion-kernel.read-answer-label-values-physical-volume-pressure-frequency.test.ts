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

describe("completion kernel volume, pressure, and frequency measured label-value read-answer", () => {
  test("accepts only the expected concise volume label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Fluid Matrix",
      url: "https://example.test/fluids",
      visibleContent: "Fluid Matrix Tank volume: 12 L Backup volume: 15 L",
      pageContent:
        "Fluid Matrix Tank volume: 12 L. Backup volume: 15 L. The page explains fluid handling, reservoir policy, service limits, audit notes, incident routing, maintenance coordination, warehouse ownership, escalation routing, and manager review so operators can answer fluid questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the tank volume?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "12L",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "15L",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "tank volume",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept volume concise answers without a volume label", () => {
    const snap = workflowSnapshot({
      title: "Fluid Matrix",
      url: "https://example.test/fluids",
      visibleContent: "Fluid Matrix Team code: 12L Backup code: 15L",
      pageContent:
        "Fluid Matrix Team code: 12L. Backup code: 15L. The page explains fluid handling, reservoir policy, service limits, audit notes, incident routing, maintenance coordination, warehouse ownership, escalation routing, and manager review so operators can answer fluid questions from visible page evidence.",
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
      summary: "12L",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise pressure label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Pressure Matrix",
      url: "https://example.test/pressure",
      visibleContent:
        "Pressure Matrix Tank pressure: 35 psi Backup pressure: 40 psi",
      pageContent:
        "Pressure Matrix Tank pressure: 35 psi. Backup pressure: 40 psi. The page explains hydraulic monitoring, pneumatic policy, service limits, audit notes, incident routing, maintenance coordination, warehouse ownership, escalation routing, and manager review so operators can answer pressure questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the tank pressure?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "35psi",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "40psi",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "tank pressure",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept pressure concise answers without a pressure label", () => {
    const snap = workflowSnapshot({
      title: "Pressure Matrix",
      url: "https://example.test/pressure",
      visibleContent: "Pressure Matrix Team code: 35psi Backup code: 40psi",
      pageContent:
        "Pressure Matrix Team code: 35psi. Backup code: 40psi. The page explains hydraulic monitoring, pneumatic policy, service limits, audit notes, incident routing, maintenance coordination, warehouse ownership, escalation routing, and manager review so operators can answer pressure questions from visible page evidence.",
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
      summary: "35psi",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise frequency label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Display Matrix",
      url: "https://example.test/display",
      visibleContent:
        "Display Matrix Refresh frequency: 60 Hz Backup frequency: 75 Hz",
      pageContent:
        "Display Matrix Refresh frequency: 60 Hz. Backup frequency: 75 Hz. The page explains display timing, refresh policy, service limits, audit notes, incident routing, maintenance coordination, device ownership, escalation routing, and manager review so operators can answer display questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the refresh frequency?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "60Hz",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "75Hz",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "refresh frequency",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept frequency concise answers without a frequency label", () => {
    const snap = workflowSnapshot({
      title: "Display Matrix",
      url: "https://example.test/display",
      visibleContent: "Display Matrix Team code: 60Hz Backup code: 75Hz",
      pageContent:
        "Display Matrix Team code: 60Hz. Backup code: 75Hz. The page explains display timing, refresh policy, service limits, audit notes, incident routing, maintenance coordination, device ownership, escalation routing, and manager review so operators can answer display questions from visible page evidence.",
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
      summary: "60Hz",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });
});
