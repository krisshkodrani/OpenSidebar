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
describe("completion kernel measured label-value read-answer", () => {
  test("accepts only the expected concise duration label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Runtime Matrix",
      url: "https://example.test/runtime",
      visibleContent:
        "Runtime Matrix Request timeout: 30s Retry timeout: 60s",
      pageContent:
        "Runtime Matrix Request timeout: 30s. Retry timeout: 60s. The page explains runtime ownership, service coverage, queue behavior, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer runtime questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the request timeout?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "30s",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "60s",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "request timeout",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept unit-like concise answers without a duration label", () => {
    const snap = workflowSnapshot({
      title: "Runtime Matrix",
      url: "https://example.test/runtime",
      visibleContent: "Runtime Matrix Team code: 30s Backup code: 60s",
      pageContent:
        "Runtime Matrix Team code: 30s. Backup code: 60s. The page explains runtime ownership, service coverage, queue behavior, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer runtime questions from visible page evidence.",
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
      summary: "30s",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise data-size label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Storage Matrix",
      url: "https://example.test/storage",
      visibleContent:
        "Storage Matrix Artifact size: 512 MB Backup size: 1 GB",
      pageContent:
        "Storage Matrix Artifact size: 512 MB. Backup size: 1 GB. The page explains storage ownership, capacity planning, quota behavior, upload limits, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer storage questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the artifact size?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "512MB",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "1GB",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "artifact size",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept data-size concise answers without a size label", () => {
    const snap = workflowSnapshot({
      title: "Storage Matrix",
      url: "https://example.test/storage",
      visibleContent: "Storage Matrix Team code: 512MB Backup code: 1GB",
      pageContent:
        "Storage Matrix Team code: 512MB. Backup code: 1GB. The page explains storage ownership, capacity planning, quota behavior, upload limits, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer storage questions from visible page evidence.",
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
      summary: "512MB",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise data-rate label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Download speed: 50 Mbps Upload speed: 10 Mbps",
      pageContent:
        "Network Matrix Download speed: 50 Mbps. Upload speed: 10 Mbps. The page explains network ownership, bandwidth planning, throughput behavior, service limits, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the download speed?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "50Mbps",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "10Mbps",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "download speed",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept data-rate concise answers without a rate label", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent: "Network Matrix Team code: 50Mbps Backup code: 10Mbps",
      pageContent:
        "Network Matrix Team code: 50Mbps. Backup code: 10Mbps. The page explains network ownership, bandwidth planning, throughput behavior, service limits, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
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
      summary: "50Mbps",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

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

  test("accepts only the expected concise locale label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Localization Matrix",
      url: "https://example.test/localization",
      visibleContent:
        "Localization Matrix Language locale: en-US Backup locale: fr-FR",
      pageContent:
        "Localization Matrix Language locale: en-US. Backup locale: fr-FR. The page explains localization ownership, language policy, regional formatting, audit notes, incident routing, maintenance coordination, device ownership, escalation routing, and manager review so operators can answer localization questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the language locale?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "en-US",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "fr-FR",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "language locale",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("accepts only the expected concise extended locale label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Localization Matrix",
      url: "https://example.test/localization",
      visibleContent:
        "Localization Matrix Preferred locale: zh-Hans-CN Backup locale: en-US",
      pageContent:
        "Localization Matrix Preferred locale: zh-Hans-CN. Backup locale: en-US. The page explains localization ownership, language policy, regional formatting, audit notes, incident routing, maintenance coordination, device ownership, escalation routing, and manager review so operators can answer localization questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the preferred locale?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "zh-Hans-CN",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "en-US",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "preferred locale",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept locale concise answers without a locale label", () => {
    const snap = workflowSnapshot({
      title: "Localization Matrix",
      url: "https://example.test/localization",
      visibleContent:
        "Localization Matrix Team code: en-US Backup code: fr-FR",
      pageContent:
        "Localization Matrix Team code: en-US. Backup code: fr-FR. The page explains localization ownership, language policy, regional formatting, audit notes, incident routing, maintenance coordination, device ownership, escalation routing, and manager review so operators can answer localization questions from visible page evidence.",
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
      summary: "en-US",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

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
