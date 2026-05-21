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

describe("completion kernel sentence-scoped ranking factual read-answer", () => {
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

});

