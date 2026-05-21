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
});
