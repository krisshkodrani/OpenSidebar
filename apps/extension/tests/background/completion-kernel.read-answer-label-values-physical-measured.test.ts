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

describe("completion kernel physical measured label-value read-answer", () => {
  test("accepts only the expected concise temperature label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Environment Matrix",
      url: "https://example.test/environment",
      visibleContent:
        "Environment Matrix Server temperature: 72 F Backup temperature: 68 F",
      pageContent:
        "Environment Matrix Server temperature: 72 F. Backup temperature: 68 F. The page explains environment monitoring, thermal policy, service limits, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer environment questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the server temperature?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "72F",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "68F",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "server temperature",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept temperature concise answers without a temperature label", () => {
    const snap = workflowSnapshot({
      title: "Environment Matrix",
      url: "https://example.test/environment",
      visibleContent: "Environment Matrix Team code: 72F Backup code: 68F",
      pageContent:
        "Environment Matrix Team code: 72F. Backup code: 68F. The page explains environment monitoring, thermal policy, service limits, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer environment questions from visible page evidence.",
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
      summary: "72F",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise electrical label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Power Matrix",
      url: "https://example.test/power",
      visibleContent:
        "Power Matrix Output voltage: 12 V Backup voltage: 24 V",
      pageContent:
        "Power Matrix Output voltage: 12 V. Backup voltage: 24 V. The page explains power monitoring, electrical policy, service limits, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer power questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the output voltage?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "12V",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "24V",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "output voltage",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept electrical concise answers without an electrical label", () => {
    const snap = workflowSnapshot({
      title: "Power Matrix",
      url: "https://example.test/power",
      visibleContent: "Power Matrix Team code: 12V Backup code: 24V",
      pageContent:
        "Power Matrix Team code: 12V. Backup code: 24V. The page explains power monitoring, electrical policy, service limits, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer power questions from visible page evidence.",
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
      summary: "12V",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise mass label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Shipping Matrix",
      url: "https://example.test/shipping",
      visibleContent:
        "Shipping Matrix Package weight: 12 kg Backup weight: 15 kg",
      pageContent:
        "Shipping Matrix Package weight: 12 kg. Backup weight: 15 kg. The page explains shipping policy, payload handling, service limits, audit notes, incident routing, maintenance coordination, warehouse ownership, escalation routing, and manager review so operators can answer shipping questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the package weight?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "12kg",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "15kg",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "package weight",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept mass concise answers without a mass label", () => {
    const snap = workflowSnapshot({
      title: "Shipping Matrix",
      url: "https://example.test/shipping",
      visibleContent: "Shipping Matrix Team code: 12kg Backup code: 15kg",
      pageContent:
        "Shipping Matrix Team code: 12kg. Backup code: 15kg. The page explains shipping policy, payload handling, service limits, audit notes, incident routing, maintenance coordination, warehouse ownership, escalation routing, and manager review so operators can answer shipping questions from visible page evidence.",
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
      summary: "12kg",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise length label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Dimension Matrix",
      url: "https://example.test/dimensions",
      visibleContent:
        "Dimension Matrix Package width: 12 cm Backup width: 15 cm",
      pageContent:
        "Dimension Matrix Package width: 12 cm. Backup width: 15 cm. The page explains package dimensions, clearance policy, service limits, audit notes, incident routing, maintenance coordination, warehouse ownership, escalation routing, and manager review so operators can answer dimension questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the package width?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "12cm",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "15cm",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "package width",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept length concise answers without a length label", () => {
    const snap = workflowSnapshot({
      title: "Dimension Matrix",
      url: "https://example.test/dimensions",
      visibleContent: "Dimension Matrix Team code: 12cm Backup code: 15cm",
      pageContent:
        "Dimension Matrix Team code: 12cm. Backup code: 15cm. The page explains package dimensions, clearance policy, service limits, audit notes, incident routing, maintenance coordination, warehouse ownership, escalation routing, and manager review so operators can answer dimension questions from visible page evidence.",
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
      summary: "12cm",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

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
