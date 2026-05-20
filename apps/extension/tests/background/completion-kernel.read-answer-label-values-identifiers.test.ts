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
describe("completion kernel identifier label-value read-answer", () => {
  test("accepts concise grounded identifier label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Incident Matrix",
      url: "https://example.test/incidents",
      visibleContent:
        "Incident Matrix Incident number: INC0012345 Change number: CHG0099",
      pageContent:
        "Incident Matrix Incident number: INC0012345. Change number: CHG0099. The page explains service coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer incident questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the incident number?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "INC0012345",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "incident number",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept the wrong concise identifier label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Incident Matrix",
      url: "https://example.test/incidents",
      visibleContent:
        "Incident Matrix Incident number: INC0012345 Change number: CHG0099",
      pageContent:
        "Incident Matrix Incident number: INC0012345. Change number: CHG0099. The page explains service coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer incident questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the incident number?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "CHG0099",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "incident number",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded hyphenated identifier label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Incident Matrix",
      url: "https://example.test/incidents",
      visibleContent:
        "Incident Matrix Case number: CASE-1234 Related case: CASE-1234-B",
      pageContent:
        "Incident Matrix Case number: CASE-1234. Related case: CASE-1234-B. The page explains service coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer incident questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the case number?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "CASE-1234",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "case number",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept identifier prefix inside a longer identifier", () => {
    const snap = workflowSnapshot({
      title: "Incident Matrix",
      url: "https://example.test/incidents",
      visibleContent:
        "Incident Matrix Case number: CASE-1234 Related case: CASE-1234-B",
      pageContent:
        "Incident Matrix Case number: CASE-1234. Related case: CASE-1234-B. The page explains service coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer incident questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the case number?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "CASE-1234-B",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "case number",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded uuid label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Session Matrix",
      url: "https://example.test/sessions",
      visibleContent:
        "Session Matrix Session ID: 4a0402d6-ad57-435e-8db0-6bf179f30366 Request ID: 7d9dcf6e-b399-4d33-a8f2-9a60f0217a2a",
      pageContent:
        "Session Matrix Session ID: 4a0402d6-ad57-435e-8db0-6bf179f30366. Request ID: 7d9dcf6e-b399-4d33-a8f2-9a60f0217a2a. The page explains session ownership, support coverage, rollout timing, incident routing, customer impact, compatibility guidance, audit notes, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer session questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the session ID?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "4a0402d6-ad57-435e-8db0-6bf179f30366",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "session id",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling uuid label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Session Matrix",
      url: "https://example.test/sessions",
      visibleContent:
        "Session Matrix Session ID: 4a0402d6-ad57-435e-8db0-6bf179f30366 Request ID: 7d9dcf6e-b399-4d33-a8f2-9a60f0217a2a",
      pageContent:
        "Session Matrix Session ID: 4a0402d6-ad57-435e-8db0-6bf179f30366. Request ID: 7d9dcf6e-b399-4d33-a8f2-9a60f0217a2a. The page explains session ownership, support coverage, rollout timing, incident routing, customer impact, compatibility guidance, audit notes, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer session questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the session ID?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "7d9dcf6e-b399-4d33-a8f2-9a60f0217a2a",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "session id",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded hash label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Release Matrix",
      url: "https://example.test/releases",
      visibleContent:
        "Release Matrix Release SHA256 hash: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 Backup hash: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      pageContent:
        "Release Matrix Release SHA256 hash: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08. Backup hash: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855. The page explains release ownership, support coverage, rollout timing, incident routing, customer impact, compatibility guidance, audit notes, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer release questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the release SHA256 hash?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "release sha256 hash",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling hash label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Release Matrix",
      url: "https://example.test/releases",
      visibleContent:
        "Release Matrix Release SHA256 hash: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 Backup hash: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      pageContent:
        "Release Matrix Release SHA256 hash: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08. Backup hash: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855. The page explains release ownership, support coverage, rollout timing, incident routing, customer impact, compatibility guidance, audit notes, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer release questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the release SHA256 hash?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "release sha256 hash",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept hash prefix inside a longer value", () => {
    const snap = workflowSnapshot({
      title: "Release Matrix",
      url: "https://example.test/releases",
      visibleContent:
        "Release Matrix Release SHA256 hash: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 Backup hash: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      pageContent:
        "Release Matrix Release SHA256 hash: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08. Backup hash: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855. The page explains release ownership, support coverage, rollout timing, incident routing, customer impact, compatibility guidance, audit notes, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer release questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the release SHA256 hash?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08-backup",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "release sha256 hash",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded version label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Release Matrix",
      url: "https://example.test/releases",
      visibleContent:
        "Release Matrix App version: v2.4.1 API version: v2.4.0",
      pageContent:
        "Release Matrix App version: v2.4.1. API version: v2.4.0. The page explains release ownership, support coverage, rollout timing, incident routing, customer impact, compatibility guidance, audit notes, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer release questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the app version?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "v2.4.1",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "app version",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling version label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Release Matrix",
      url: "https://example.test/releases",
      visibleContent:
        "Release Matrix App version: v2.4.1 API version: v2.4.0",
      pageContent:
        "Release Matrix App version: v2.4.1. API version: v2.4.0. The page explains release ownership, support coverage, rollout timing, incident routing, customer impact, compatibility guidance, audit notes, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer release questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the app version?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "v2.4.0",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "app version",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept same-prefix longer version label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Release Matrix",
      url: "https://example.test/releases",
      visibleContent:
        "Release Matrix App version: v2.4.1 API version: v2.4.10",
      pageContent:
        "Release Matrix App version: v2.4.1. API version: v2.4.10. The page explains release ownership, support coverage, rollout timing, incident routing, customer impact, compatibility guidance, audit notes, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer release questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the app version?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "v2.4.10",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "app version",
    });
    expect(decision.status).toBe("inconclusive");
  });
});
