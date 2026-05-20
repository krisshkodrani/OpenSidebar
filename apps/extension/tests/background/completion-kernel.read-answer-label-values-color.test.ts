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
describe("completion kernel color label-value read-answer", () => {
  test("accepts only the expected concise hex color label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Primary color: #1A2B3C Backup color: #00FF00",
      pageContent:
        "Theme Matrix Primary color: #1A2B3C. Backup color: #00FF00. The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary color?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "#1A2B3C",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "#00FF00",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary color",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept hex color concise answers without a color label", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Team code: #1A2B3C Backup code: #00FF00",
      pageContent:
        "Theme Matrix Team code: #1A2B3C. Backup code: #00FF00. The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
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
      summary: "#1A2B3C",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise rgb color label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Primary color: rgb(12, 34, 56) Backup color: rgb(90, 80, 70)",
      pageContent:
        "Theme Matrix Primary color: rgb(12, 34, 56). Backup color: rgb(90, 80, 70). The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary color?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "rgb(12,34,56)",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "rgb(90,80,70)",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary color",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept rgb color concise answers without a color label", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Team code: rgb(12, 34, 56) Backup code: rgb(90, 80, 70)",
      pageContent:
        "Theme Matrix Team code: rgb(12, 34, 56). Backup code: rgb(90, 80, 70). The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
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
      summary: "rgb(12,34,56)",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise hsl color label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Primary color: hsl(210, 50%, 40%) Backup color: hsl(120, 60%, 50%)",
      pageContent:
        "Theme Matrix Primary color: hsl(210, 50%, 40%). Backup color: hsl(120, 60%, 50%). The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary color?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "hsl(210,50%,40%)",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "hsl(120,60%,50%)",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary color",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept hsl color concise answers without a color label", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Team code: hsl(210, 50%, 40%) Backup code: hsl(120, 60%, 50%)",
      pageContent:
        "Theme Matrix Team code: hsl(210, 50%, 40%). Backup code: hsl(120, 60%, 50%). The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
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
      summary: "hsl(210,50%,40%)",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise modern rgb color label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Primary color: rgb(12 34 56 / 0.5) Backup color: rgb(90 80 70 / 75%)",
      pageContent:
        "Theme Matrix Primary color: rgb(12 34 56 / 0.5). Backup color: rgb(90 80 70 / 75%). The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary color?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "rgb(12 34 56/0.5)",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "rgb(90 80 70/75%)",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary color",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("accepts only the expected concise modern hsl color label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Primary color: hsl(210 50% 40% / 0.75) Backup color: hsl(120 60% 50% / 75%)",
      pageContent:
        "Theme Matrix Primary color: hsl(210 50% 40% / 0.75). Backup color: hsl(120 60% 50% / 75%). The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary color?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "hsl(210 50% 40%/0.75)",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "hsl(120 60% 50%/75%)",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary color",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept modern slash color concise answers without a color label", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Team code: rgb(12 34 56 / 0.5) Backup code: hsl(120 60% 50% / 75%)",
      pageContent:
        "Theme Matrix Team code: rgb(12 34 56 / 0.5). Backup code: hsl(120 60% 50% / 75%). The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
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
      summary: "rgb(12 34 56/0.5)",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise named color label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Primary color: rebeccapurple Backup color: steelblue",
      pageContent:
        "Theme Matrix Primary color: rebeccapurple. Backup color: steelblue. The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary color?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "rebeccapurple",
    });
    const rejectedSibling = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "steelblue",
    });
    const rejectedCompound = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "rebeccapurple-blue",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary color",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejectedSibling.status).toBe("inconclusive");
    expect(rejectedCompound.status).toBe("inconclusive");
  });

  test("does not accept named color concise answers without a color label", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Team code: rebeccapurple Backup code: steelblue",
      pageContent:
        "Theme Matrix Team code: rebeccapurple. Backup code: steelblue. The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
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
      summary: "rebeccapurple",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });
});
