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
describe("completion kernel temporal measured label-value read-answer", () => {
  test("accepts concise grounded date label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Schedule Matrix",
      url: "https://example.test/schedule",
      visibleContent:
        "Schedule Matrix Due date: 2026-05-18 Review date: 2026-06-01",
      pageContent:
        "Schedule Matrix Due date: 2026-05-18. Review date: 2026-06-01. The page explains schedule ownership, release priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer schedule questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "When is the due date?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2026-05-18",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "due date",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept the wrong concise date label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Schedule Matrix",
      url: "https://example.test/schedule",
      visibleContent:
        "Schedule Matrix Due date: 2026-05-18 Review date: 2026-06-01",
      pageContent:
        "Schedule Matrix Due date: 2026-05-18. Review date: 2026-06-01. The page explains schedule ownership, release priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer schedule questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "When is the due date?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2026-06-01",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "due date",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise date-range label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Release Matrix",
      url: "https://example.test/releases",
      visibleContent:
        "Release Matrix Deployment window: 2026-05-18 - 2026-05-20 Backup window: 2026-06-01 - 2026-06-03",
      pageContent:
        "Release Matrix Deployment window: 2026-05-18 - 2026-05-20. Backup window: 2026-06-01 - 2026-06-03. The page explains release ownership, deployment policy, schedule windows, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer release questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the deployment window?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2026-05-18-2026-05-20",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2026-06-01-2026-06-03",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "deployment window",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("accepts date-range label-value answer with to separator", () => {
    const snap = workflowSnapshot({
      title: "Freeze Matrix",
      url: "https://example.test/freezes",
      visibleContent:
        "Freeze Matrix Freeze period: 2026-11-01 to 2026-11-15 Backup period: 2026-12-01 to 2026-12-15",
      pageContent:
        "Freeze Matrix Freeze period: 2026-11-01 to 2026-11-15. Backup period: 2026-12-01 to 2026-12-15. The page explains freeze ownership, release policy, schedule windows, audit notes, incident routing, maintenance coordination, environment ownership, escalation routing, and manager review so operators can answer freeze questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the freeze period?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2026-11-01 to 2026-11-15",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "freeze period",
    });
    expect(accepted.status).toBe("accepted");
  });

  test("does not accept date-range concise answers without a date-range label", () => {
    const snap = workflowSnapshot({
      title: "Release Matrix",
      url: "https://example.test/releases",
      visibleContent:
        "Release Matrix Team code: 2026-05-18 - 2026-05-20 Backup code: 2026-06-01 - 2026-06-03",
      pageContent:
        "Release Matrix Team code: 2026-05-18 - 2026-05-20. Backup code: 2026-06-01 - 2026-06-03. The page explains release ownership, deployment policy, schedule windows, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer release questions from visible page evidence.",
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
      summary: "2026-05-18 - 2026-05-20",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded time label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Schedule Matrix",
      url: "https://example.test/schedule",
      visibleContent:
        "Schedule Matrix Maintenance time: 14:30 Review time: 15:30",
      pageContent:
        "Schedule Matrix Maintenance time: 14:30. Review time: 15:30. The page explains schedule ownership, release priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer schedule questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "When is the maintenance time?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "14:30",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "maintenance time",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts only the expected concise UTC timezone label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Schedule Matrix",
      url: "https://example.test/schedule",
      visibleContent:
        "Schedule Matrix Time zone: UTC+02:00 Backup time zone: UTC-05:00",
      pageContent:
        "Schedule Matrix Time zone: UTC+02:00. Backup time zone: UTC-05:00. The page explains schedule ownership, time zone policy, service windows, audit notes, incident routing, maintenance coordination, device ownership, escalation routing, and manager review so operators can answer schedule questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the time zone?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "UTC+02:00",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "UTC-05:00",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "time zone",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("accepts only the expected concise IANA timezone label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Deployment Matrix",
      url: "https://example.test/deployments",
      visibleContent:
        "Deployment Matrix Deployment timezone: Europe/Berlin Backup timezone: America/New_York",
      pageContent:
        "Deployment Matrix Deployment timezone: Europe/Berlin. Backup timezone: America/New_York. The page explains deployment ownership, time zone policy, service windows, audit notes, incident routing, maintenance coordination, device ownership, escalation routing, and manager review so operators can answer deployment questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the deployment timezone?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Europe/Berlin",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "America/New_York",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "deployment timezone",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept timezone concise answers without a timezone label", () => {
    const snap = workflowSnapshot({
      title: "Schedule Matrix",
      url: "https://example.test/schedule",
      visibleContent:
        "Schedule Matrix Team code: UTC+02:00 Backup code: UTC-05:00",
      pageContent:
        "Schedule Matrix Team code: UTC+02:00. Backup code: UTC-05:00. The page explains schedule ownership, time zone policy, service windows, audit notes, incident routing, maintenance coordination, device ownership, escalation routing, and manager review so operators can answer schedule questions from visible page evidence.",
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
      summary: "UTC+02:00",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise time-window label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Maintenance Matrix",
      url: "https://example.test/maintenance",
      visibleContent:
        "Maintenance Matrix Maintenance window: 02:00-04:00 Backup window: 05:00-07:00",
      pageContent:
        "Maintenance Matrix Maintenance window: 02:00-04:00. Backup window: 05:00-07:00. The page explains maintenance ownership, schedule policy, service windows, audit notes, incident routing, coordination plans, device ownership, escalation routing, and manager review so operators can answer maintenance questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the maintenance window?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "02:00-04:00",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "05:00-07:00",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "maintenance window",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("accepts spaced time-window label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix Service window: 09:00 - 17:30 Backup window: 18:00 - 20:00",
      pageContent:
        "Support Matrix Service window: 09:00 - 17:30. Backup window: 18:00 - 20:00. The page explains support ownership, service hours, schedule policy, audit notes, incident routing, coordination plans, queue ownership, escalation routing, and manager review so operators can answer support questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the service window?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "09:00-17:30",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "service window",
    });
    expect(accepted.status).toBe("accepted");
  });

  test("does not accept time-window concise answers without a time-window label", () => {
    const snap = workflowSnapshot({
      title: "Maintenance Matrix",
      url: "https://example.test/maintenance",
      visibleContent:
        "Maintenance Matrix Team code: 02:00-04:00 Backup code: 05:00-07:00",
      pageContent:
        "Maintenance Matrix Team code: 02:00-04:00. Backup code: 05:00-07:00. The page explains maintenance ownership, schedule policy, service windows, audit notes, incident routing, coordination plans, device ownership, escalation routing, and manager review so operators can answer maintenance questions from visible page evidence.",
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
      summary: "02:00-04:00",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });
});
