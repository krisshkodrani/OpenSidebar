import { describe, expect, test } from "vitest";
import "../setup";
import {
  deriveCompletionEvidenceFromSnapshot,
  deriveCompletionEvidenceFromToolOutcome,
  evaluateCompletionContract,
  generateCompletionContract,
} from "../../src/background/agent/completion-kernel";
import { ToolName, type DomSnapshot } from "../../src/types";

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

describe("completion kernel sentence-scoped metric and state factual read-answer", () => {
  test("accepts target metric-value answer with possessive prose", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas's completion rate is 87%. Project Borealis's completion rate is 62%.",
      pageContent:
        "Project Atlas's completion rate is 87%. Project Borealis's completion rate is 62%. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is Project Atlas's completion rate?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "87%",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "62%",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "completion rate value",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts target metric-value answer with read_page evidence", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "Completion rate for Project Atlas is 87%. Completion rate for Project Borealis is 62%.",
      pageContent:
        "Completion rate for Project Atlas is 87%. Completion rate for Project Borealis is 62%. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the completion rate for Project Atlas?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nCompletion rate for Project Atlas is 87%. Completion rate for Project Borealis is 62%. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "87%",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "62%",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "completion rate value",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("does not accept a target metric-value sentence with the wrong requested metric", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas's error rate is 87%. Project Borealis's completion rate is 62%.",
      pageContent:
        "Project Atlas's error rate is 87%. Project Borealis's completion rate is 62%. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is Project Atlas's completion rate?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "87%",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("does not use target metric-value acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "Project Metrics Project Atlas's completion rate is 87% Project Borealis's completion rate is 62%",
      pageContent:
        "Project Metrics Project Atlas's completion rate is 87% Project Borealis's completion rate is 62%. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "What is Project Atlas's completion rate?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "87%",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("accepts target named-attribute answer with possessive prose", () => {
    const snap = workflowSnapshot({
      title: "Project Directory",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas's region is EMEA. Project Borealis's region is APAC.",
      pageContent:
        "Project Atlas's region is EMEA. Project Borealis's region is APAC. The page explains project directory attributes, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project attribute questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is Project Atlas's region?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "EMEA",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "APAC",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "region",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts target named-attribute answer with read_page evidence", () => {
    const snap = workflowSnapshot({
      title: "Project Directory",
      url: "https://example.test/projects",
      visibleContent:
        "Environment for Project Atlas is Production. Environment for Project Borealis is Staging.",
      pageContent:
        "Environment for Project Atlas is Production. Environment for Project Borealis is Staging. The page explains project directory attributes, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project attribute questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the environment for Project Atlas?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nEnvironment for Project Atlas is Production. Environment for Project Borealis is Staging. The page explains project directory attributes, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project attribute questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Production",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Staging",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "environment",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts target named-attribute answer without treating it as a metric value", () => {
    const snap = workflowSnapshot({
      title: "Project Directory",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas's type is Migration. Project Borealis's type is Maintenance.",
      pageContent:
        "Project Atlas's type is Migration. Project Borealis's type is Maintenance. The page explains project directory attributes, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project attribute questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is Project Atlas's type?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Migration",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "type",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts additional bounded target named-attribute labels", () => {
    const scenarios = [
      {
        label: "category",
        request: "What is Project Atlas's category?",
        evidence:
          "Project Atlas's category is Internal Tools. Project Borealis's category is Customer Apps.",
        summary: "Internal Tools",
      },
      {
        label: "tier",
        request: "What is Project Atlas's tier?",
        evidence:
          "Project Atlas's tier is Enterprise. Project Borealis's tier is Standard.",
        summary: "Enterprise",
      },
      {
        label: "plan",
        request: "What is Project Atlas's plan?",
        evidence:
          "Project Atlas's plan is Premium Plus. Project Borealis's plan is Basic.",
        summary: "Premium Plus",
      },
    ];

    for (const scenario of scenarios) {
      const snap = workflowSnapshot({
        title: "Project Directory",
        url: "https://example.test/projects",
        visibleContent: scenario.evidence,
        pageContent:
          `${scenario.evidence} The page explains project directory attributes, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project attribute questions from visible prose evidence.`,
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
        expectedAnswerTarget: "Project Atlas",
        expectedAnswerScope: "sentence",
      });
      expect(decision.status).toBe("accepted");
    }
  });

  test("does not accept a target named-attribute sentence with the wrong requested attribute", () => {
    const snap = workflowSnapshot({
      title: "Project Directory",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas's environment is EMEA. Project Borealis's region is APAC.",
      pageContent:
        "Project Atlas's environment is EMEA. Project Borealis's region is APAC. The page explains project directory attributes, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project attribute questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is Project Atlas's region?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "EMEA",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("does not use target named-attribute acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Project Directory",
      url: "https://example.test/projects",
      visibleContent:
        "Project Directory Project Atlas's region is EMEA Project Borealis's region is APAC",
      pageContent:
        "Project Directory Project Atlas's region is EMEA Project Borealis's region is APAC. The page explains project directory attributes, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project attribute questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "What is Project Atlas's region?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "EMEA",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });
});
