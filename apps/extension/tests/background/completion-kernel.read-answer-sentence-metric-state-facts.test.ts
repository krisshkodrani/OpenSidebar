import { describe, expect, test } from "vitest";
import "../setup";
import {
  deriveCompletionEvidenceFromSnapshot,
  deriveCompletionEvidenceFromToolOutcome,
  evaluateCompletionContract,
  generateCompletionContract,
} from "../../src/background/agent/completion-kernel";
import { ToolName, type DomSnapshot, type TaggedElement } from "../../src/types";

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

function rowElement(tag: number, text: string): TaggedElement {
  const key = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    tag,
    tagName: "tr",
    role: "row",
    text,
    attributes: {
      id: `row-${key}`,
    },
    rect: { x: 0, y: tag * 20, width: 600, height: 32 },
    isVisible: true,
    isDisabled: false,
  };
}

describe("completion kernel sentence-scoped metric and state factual read-answer", () => {
  test("accepts target-count sentence-scoped answer for a how-many question", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas has 17 open incidents. Project Borealis has 4 open incidents.",
      pageContent:
        "Project Atlas has 17 open incidents. Project Borealis has 4 open incidents. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "How many open incidents does Project Atlas have?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Project Atlas has 17 open incidents.",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Project Atlas has 4 open incidents.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open incidents count",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts target-count sentence-scoped answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas has 17 open incidents. Project Borealis has 4 open incidents.",
      pageContent:
        "Project Atlas has 17 open incidents. Project Borealis has 4 open incidents. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "How many open incidents does Project Atlas have?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProject Atlas has 17 open incidents. Project Borealis has 4 open incidents. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "17",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "4",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open incidents count",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts target-count answer with current-count adverbs", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas currently has 17 open incidents. Project Borealis currently has 4 open incidents.",
      pageContent:
        "Project Atlas currently has 17 open incidents. Project Borealis currently has 4 open incidents. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "How many open incidents does Project Atlas currently have?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "17",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "4",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open incidents count",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts existential target-count answer with currently read_page evidence", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "There are currently 17 open incidents for Project Atlas. There are currently 4 open incidents for Project Borealis.",
      pageContent:
        "There are currently 17 open incidents for Project Atlas. There are currently 4 open incidents for Project Borealis. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "How many open incidents are there currently for Project Atlas?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nThere are currently 17 open incidents for Project Atlas. There are currently 4 open incidents for Project Borealis. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "17",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "4",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open incidents count",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts target-count zero answer with no-longer evidence", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas no longer has any open incidents. Project Borealis currently has 4 open incidents.",
      pageContent:
        "Project Atlas no longer has any open incidents. Project Borealis currently has 4 open incidents. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "How many open incidents does Project Atlas have?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "0",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "4",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open incidents count",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts existential target-count zero answer with no-longer read_page evidence", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "There are no longer any open incidents for Project Atlas. There are currently 4 open incidents for Project Borealis.",
      pageContent:
        "There are no longer any open incidents for Project Atlas. There are currently 4 open incidents for Project Borealis. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "How many open incidents are there for Project Atlas?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nThere are no longer any open incidents for Project Atlas. There are currently 4 open incidents for Project Borealis. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "zero",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "4",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open incidents count",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts target-count answer with remaining phrasing", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas has 3 open incidents remaining. Project Borealis has 4 open incidents remaining.",
      pageContent:
        "Project Atlas has 3 open incidents remaining. Project Borealis has 4 open incidents remaining. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "How many open incidents remain for Project Atlas?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "3",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "4",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open incidents count",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts existential target-count answer with left read_page evidence", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "There are 3 open incidents left for Project Atlas. There are 4 open incidents left for Project Borealis.",
      pageContent:
        "There are 3 open incidents left for Project Atlas. There are 4 open incidents left for Project Borealis. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "How many open incidents are left for Project Atlas?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nThere are 3 open incidents left for Project Atlas. There are 4 open incidents left for Project Borealis. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "3",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "4",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open incidents count",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("does not accept a target-count sentence with the wrong requested metric", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas has 17 closed incidents. Project Borealis has 4 open incidents.",
      pageContent:
        "Project Atlas has 17 closed incidents. Project Borealis has 4 open incidents. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "How many open incidents does Project Atlas have?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Project Atlas has 4 open incidents.",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("does not use target-count sentence-scoped acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "Project Metrics Project Atlas has 17 open incidents Project Borealis has 4 open incidents",
      pageContent:
        "Project Metrics Project Atlas has 17 open incidents Project Borealis has 4 open incidents. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "How many open incidents does Project Atlas have?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Project Atlas has 17 open incidents.",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

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

  test("accepts target-presence sentence-scoped yes answer for a metric existence question", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas has 17 open incidents. Project Borealis has no open incidents.",
      pageContent:
        "Project Atlas has 17 open incidents. Project Borealis has no open incidents. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Does Project Atlas have any open incidents?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Yes, Project Atlas has open incidents.",
    });
    const wrongAnswer = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "No.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open incidents presence",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(wrongAnswer.status).toBe("inconclusive");
  });

  test("accepts target-presence sentence-scoped no answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas has no open incidents. Project Borealis has 4 open incidents.",
      pageContent:
        "Project Atlas has no open incidents. Project Borealis has 4 open incidents. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Does Project Atlas have any open incidents?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProject Atlas has no open incidents. Project Borealis has 4 open incidents. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "No, Project Atlas has no open incidents.",
    });
    const wrongAnswer = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Yes.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open incidents presence",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(wrongAnswer.status).toBe("inconclusive");
  });

  test("accepts target-presence sentence-scoped answer with current-presence adverbs", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas currently has 17 open incidents. Project Borealis currently has no open incidents.",
      pageContent:
        "Project Atlas currently has 17 open incidents. Project Borealis currently has no open incidents. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Does Project Atlas currently have any open incidents?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Yes, Project Atlas currently has open incidents.",
    });
    const wrongAnswer = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "No.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open incidents presence",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(wrongAnswer.status).toBe("inconclusive");
  });

  test("accepts target-presence no answer with still evidence from read_page", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas still has no open incidents. Project Borealis still has 4 open incidents.",
      pageContent:
        "Project Atlas still has no open incidents. Project Borealis still has 4 open incidents. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Does Project Atlas still have any open incidents?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProject Atlas still has no open incidents. Project Borealis still has 4 open incidents. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "No, Project Atlas still has no open incidents.",
    });
    const wrongAnswer = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Yes.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open incidents presence",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(wrongAnswer.status).toBe("inconclusive");
  });

  test("accepts existential target-presence answer with current-presence adverbs", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "There are currently 17 open incidents for Project Atlas. There are currently no open incidents for Project Borealis.",
      pageContent:
        "There are currently 17 open incidents for Project Atlas. There are currently no open incidents for Project Borealis. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Are there currently any open incidents for Project Atlas?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Yes, there are currently open incidents for Project Atlas.",
    });
    const wrongAnswer = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "No.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open incidents presence",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(wrongAnswer.status).toBe("inconclusive");
  });

  test("accepts existential target-presence no answer with still read_page evidence", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "There are still no open incidents for Project Atlas. There are still 4 open incidents for Project Borealis.",
      pageContent:
        "There are still no open incidents for Project Atlas. There are still 4 open incidents for Project Borealis. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Are there still any open incidents for Project Atlas?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nThere are still no open incidents for Project Atlas. There are still 4 open incidents for Project Borealis. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "No, there are still no open incidents for Project Atlas.",
    });
    const wrongAnswer = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Yes.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open incidents presence",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(wrongAnswer.status).toBe("inconclusive");
  });

  test("accepts target-presence no answer with no-longer evidence", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas no longer has any open incidents. Project Borealis currently has 4 open incidents.",
      pageContent:
        "Project Atlas no longer has any open incidents. Project Borealis currently has 4 open incidents. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Does Project Atlas have any open incidents?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "No, Project Atlas no longer has any open incidents.",
    });
    const wrongAnswer = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Yes.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open incidents presence",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(wrongAnswer.status).toBe("inconclusive");
  });

  test("accepts existential target-presence no answer with no-longer read_page evidence", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "There are no longer any open incidents for Project Atlas. There are currently 4 open incidents for Project Borealis.",
      pageContent:
        "There are no longer any open incidents for Project Atlas. There are currently 4 open incidents for Project Borealis. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Are there any open incidents for Project Atlas?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nThere are no longer any open incidents for Project Atlas. There are currently 4 open incidents for Project Borealis. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "No, there are no longer any open incidents for Project Atlas.",
    });
    const wrongAnswer = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Yes.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open incidents presence",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(wrongAnswer.status).toBe("inconclusive");
  });

  test("does not accept target-presence evidence for the wrong requested metric", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas has 17 closed incidents. Project Borealis has 4 open incidents.",
      pageContent:
        "Project Atlas has 17 closed incidents. Project Borealis has 4 open incidents. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Does Project Atlas have any open incidents?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Yes, Project Atlas has open incidents.",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("does not use target-presence sentence-scoped acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "Project Metrics Project Atlas has 17 open incidents Project Borealis has no open incidents",
      pageContent:
        "Project Metrics Project Atlas has 17 open incidents Project Borealis has no open incidents. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Does Project Atlas have any open incidents?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Yes, Project Atlas has open incidents.",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("accepts superlative metric read-answer for the highest visible candidate", () => {
    const snap = workflowSnapshot({
      title: "Warehouse Counts",
      url: "https://example.test/warehouses",
      visibleContent:
        "Warehouse Beta inventory count is 7,318 units. Warehouse Delta inventory count is 2,184 units.",
      pageContent:
        "Warehouse Beta inventory count is 7,318 units. Warehouse Delta inventory count is 2,184 units. The page compares inventory counts, receiving backlog, audit timing, and replenishment notes so operators can answer warehouse metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Which warehouse has the highest inventory count?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Warehouse Beta has the highest inventory count.",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Warehouse Delta has the highest inventory count.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "inventory count highest target",
      expectedAnswerTarget: "Warehouse Beta",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts superlative metric read-answer from read_page evidence", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas has 17 open incidents. Project Borealis has 4 open incidents.",
      pageContent:
        "Project Atlas has 17 open incidents. Project Borealis has 4 open incidents. The page compares project incident counts, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Which project has the fewest open incidents?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProject Atlas has 17 open incidents. Project Borealis has 4 open incidents. The page compares project incident counts, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Project Borealis has the fewest open incidents.",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Project Atlas has the fewest open incidents.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open incidents lowest target",
      expectedAnswerTarget: "Project Borealis",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("does not generate superlative metric read-answer when the visible winner is tied", () => {
    const snap = workflowSnapshot({
      title: "Warehouse Counts",
      url: "https://example.test/warehouses",
      visibleContent:
        "Warehouse Beta inventory count is 7,318 units. Warehouse Delta inventory count is 7,318 units.",
      pageContent:
        "Warehouse Beta inventory count is 7,318 units. Warehouse Delta inventory count is 7,318 units. The page compares inventory counts, receiving backlog, audit timing, and replenishment notes so operators can answer warehouse metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Which warehouse has the highest inventory count?",
      snapshot: snap,
    });

    expect(generated).toBeNull();
  });

  test("does not use superlative metric read-answer from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Warehouse Counts",
      url: "https://example.test/warehouses",
      visibleContent:
        "Warehouse Counts Warehouse Beta inventory count is 7,318 units Warehouse Delta inventory count is 2,184 units",
      pageContent:
        "Warehouse Counts Warehouse Beta inventory count is 7,318 units Warehouse Delta inventory count is 2,184 units. The page compares inventory counts, receiving backlog, audit timing, and replenishment notes so operators can answer warehouse metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Which warehouse has the highest inventory count?",
      snapshot: snap,
    });

    expect(generated).toBeNull();
  });

  test("accepts superlative metric read-answer from visible row elements", () => {
    const snap = workflowSnapshot({
      title: "Warehouse Counts",
      url: "https://example.test/warehouses",
      visibleContent:
        "Warehouse Counts Warehouse Beta Inventory count: 7,318 units Warehouse Delta Inventory count: 2,184 units",
      pageContent:
        "Warehouse Counts. The page compares warehouse inventory counts, receiving backlog, audit timing, and replenishment notes so operators can answer warehouse metric questions from visible row evidence.",
      elements: [
        rowElement(811, "Warehouse Beta Inventory count: 7,318 units"),
        rowElement(812, "Warehouse Delta Inventory count: 2,184 units"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Which warehouse has the highest inventory count?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Warehouse Beta has the highest inventory count.",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Warehouse Delta has the highest inventory count.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "inventory count highest target",
      expectedAnswerTarget: "Warehouse Beta",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts row-superlative metric read-answer without explanatory page text", () => {
    const snap = workflowSnapshot({
      title: "Warehouse Counts",
      url: "https://example.test/warehouses",
      visibleContent:
        "Warehouse Beta Inventory count: 7,318 units Warehouse Delta Inventory count: 2,184 units",
      pageContent: "Warehouse Counts",
      elements: [
        rowElement(811, "Warehouse Beta Inventory count: 7,318 units"),
        rowElement(812, "Warehouse Delta Inventory count: 2,184 units"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Which warehouse has the highest inventory count?",
      snapshot: snap,
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "inventory count highest target",
      expectedAnswerTarget: "Warehouse Beta",
      expectedAnswerScope: "sentence",
    });
  });

  test("accepts row-superlative metric read-answer from read_page line evidence", () => {
    const snap = workflowSnapshot({
      title: "Warehouse Counts",
      url: "https://example.test/warehouses",
      visibleContent:
        "Warehouse Counts Warehouse Beta Inventory count: 7,318 units Warehouse Delta Inventory count: 2,184 units",
      pageContent:
        "Warehouse Counts. The page compares warehouse inventory counts, receiving backlog, audit timing, and replenishment notes so operators can answer warehouse metric questions from visible row evidence.",
      elements: [
        rowElement(811, "Warehouse Beta Inventory count: 7,318 units"),
        rowElement(812, "Warehouse Delta Inventory count: 2,184 units"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Which warehouse has the highest inventory count?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nWarehouse Beta Inventory count: 7,318 units\nWarehouse Delta Inventory count: 2,184 units\nThe page compares warehouse inventory counts, receiving backlog, audit timing, and replenishment notes so operators can answer warehouse metric questions from visible row evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Warehouse Beta",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "inventory count highest target",
      expectedAnswerTarget: "Warehouse Beta",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
  });

  test("does not generate row-superlative metric read-answer when visible rows are tied", () => {
    const snap = workflowSnapshot({
      title: "Warehouse Counts",
      url: "https://example.test/warehouses",
      visibleContent:
        "Warehouse Counts Warehouse Beta Inventory count: 7,318 units Warehouse Delta Inventory count: 7,318 units",
      pageContent:
        "Warehouse Counts. The page compares warehouse inventory counts, receiving backlog, audit timing, and replenishment notes so operators can answer warehouse metric questions from visible row evidence.",
      elements: [
        rowElement(811, "Warehouse Beta Inventory count: 7,318 units"),
        rowElement(812, "Warehouse Delta Inventory count: 7,318 units"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Which warehouse has the highest inventory count?",
      snapshot: snap,
    });

    expect(generated).toBeNull();
  });

  test("accepts target-state sentence-scoped yes answer for a state question", () => {
    const snap = workflowSnapshot({
      title: "Project Status",
      url: "https://example.test/projects/status",
      visibleContent:
        "Project Atlas is blocked. Project Borealis is active.",
      pageContent:
        "Project Atlas is blocked. Project Borealis is active. The page explains project status, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project state questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Is Project Atlas blocked?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Yes.",
    });
    const wrongAnswer = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "No.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "blocked state",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(wrongAnswer.status).toBe("inconclusive");
  });

  test("accepts target-state sentence-scoped no answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Status",
      url: "https://example.test/projects/status",
      visibleContent:
        "Project Atlas is not blocked. Project Borealis is blocked.",
      pageContent:
        "Project Atlas is not blocked. Project Borealis is blocked. The page explains project status, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project state questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Is Project Atlas blocked?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProject Atlas is not blocked. Project Borealis is blocked. The page explains project status, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project state questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "No, Project Atlas is not blocked.",
    });
    const wrongAnswer = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Yes.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "blocked state",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(wrongAnswer.status).toBe("inconclusive");
  });

  test("does not accept a target-state sentence from a sibling target", () => {
    const snap = workflowSnapshot({
      title: "Project Status",
      url: "https://example.test/projects/status",
      visibleContent:
        "Project Atlas is active. Project Borealis is blocked.",
      pageContent:
        "Project Atlas is active. Project Borealis is blocked. The page explains project status, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project state questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Is Project Atlas blocked?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Yes, Project Atlas is blocked.",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("does not use target-state sentence-scoped acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Project Status",
      url: "https://example.test/projects/status",
      visibleContent:
        "Project Status Project Atlas is blocked Project Borealis is active",
      pageContent:
        "Project Status Project Atlas is blocked Project Borealis is active. The page explains project status, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project state questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Is Project Atlas blocked?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Yes, Project Atlas is blocked.",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("accepts target-state sentence-scoped answer with current-state adverbs", () => {
    const snap = workflowSnapshot({
      title: "Project Status",
      url: "https://example.test/projects/status",
      visibleContent:
        "Project Atlas is currently blocked. Project Borealis is active.",
      pageContent:
        "Project Atlas is currently blocked. Project Borealis is active. The page explains project status, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project state questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Is Project Atlas still blocked?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Yes, Project Atlas is still blocked.",
    });
    const wrongAnswer = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "No.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "blocked state",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(wrongAnswer.status).toBe("inconclusive");
  });

  test("accepts target-state no answer with no-longer evidence from read_page", () => {
    const snap = workflowSnapshot({
      title: "Project Status",
      url: "https://example.test/projects/status",
      visibleContent:
        "Project Atlas is no longer blocked. Project Borealis is blocked.",
      pageContent:
        "Project Atlas is no longer blocked. Project Borealis is blocked. The page explains project status, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project state questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Is Project Atlas currently blocked?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProject Atlas is no longer blocked. Project Borealis is blocked. The page explains project status, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project state questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "No, Project Atlas is no longer blocked.",
    });
    const wrongAnswer = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Yes.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "blocked state",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(wrongAnswer.status).toBe("inconclusive");
  });
});
