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

describe("completion kernel row aggregate median/range/extreme-value read-answer", () => {
  test("accepts row metric-median read-answer from visible row elements", () => {
    const snap = workflowSnapshot({
      title: "Warehouse Counts",
      url: "https://example.test/warehouses",
      visibleContent:
        "Warehouse Beta Inventory count: 7318 units Warehouse Delta Inventory count: 2184 units Warehouse Gamma Inventory count: 4100 units",
      pageContent: "Warehouse Counts",
      elements: [
        rowElement(811, "Warehouse Beta Inventory count: 7318 units"),
        rowElement(812, "Warehouse Delta Inventory count: 2184 units"),
        rowElement(813, "Warehouse Gamma Inventory count: 4100 units"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "What is the median inventory count across warehouses?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "The median inventory count is 4100.",
    });
    const wrongMedian = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "The median inventory count is 7318.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "inventory count median",
      expectedAnswerScope: "aggregate",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:aggregate:",
    );
    expect(wrongMedian.status).toBe("inconclusive");
  });

  test("accepts row metric-median read-answer from read_page line evidence", () => {
    const snap = workflowSnapshot({
      title: "Warehouse Counts",
      url: "https://example.test/warehouses",
      visibleContent:
        "Warehouse Beta Inventory count: 7318 units Warehouse Delta Inventory count: 2184 units Warehouse Gamma Inventory count: 4100 units",
      pageContent: "Warehouse Counts",
      elements: [
        rowElement(811, "Warehouse Beta Inventory count: 7318 units"),
        rowElement(812, "Warehouse Delta Inventory count: 2184 units"),
        rowElement(813, "Warehouse Gamma Inventory count: 4100 units"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "What is the median inventory count across warehouses?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nWarehouse Beta Inventory count: 7318 units\nWarehouse Delta Inventory count: 2184 units\nWarehouse Gamma Inventory count: 4100 units\nThe page compares warehouse inventory counts, receiving backlog, audit timing, and replenishment notes so operators can answer warehouse metric median questions from visible row evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "4100",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "inventory count median",
      expectedAnswerScope: "aggregate",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:aggregate-text:",
    );
  });

  test("does not generate row metric-median read-answer with only one row candidate", () => {
    const snap = workflowSnapshot({
      title: "Warehouse Counts",
      url: "https://example.test/warehouses",
      visibleContent: "Warehouse Beta Inventory count: 7318 units",
      pageContent: "Warehouse Counts",
      elements: [rowElement(811, "Warehouse Beta Inventory count: 7318 units")],
    });
    const generated = generateCompletionContract({
      userRequest: "What is the median inventory count across warehouses?",
      snapshot: snap,
    });

    expect(generated).toBeNull();
  });

  test("accepts row metric-range read-answer from visible row elements", () => {
    const snap = workflowSnapshot({
      title: "Warehouse Counts",
      url: "https://example.test/warehouses",
      visibleContent:
        "Warehouse Beta Inventory count: 7318 units Warehouse Delta Inventory count: 2184 units Warehouse Gamma Inventory count: 4100 units",
      pageContent: "Warehouse Counts",
      elements: [
        rowElement(811, "Warehouse Beta Inventory count: 7318 units"),
        rowElement(812, "Warehouse Delta Inventory count: 2184 units"),
        rowElement(813, "Warehouse Gamma Inventory count: 4100 units"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "What is the range of inventory count across warehouses?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "The inventory count range is 5134.",
    });
    const wrongRange = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "The inventory count range is 4100.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "inventory count range",
      expectedAnswerScope: "aggregate",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:aggregate:",
    );
    expect(wrongRange.status).toBe("inconclusive");
  });

  test("accepts row metric-range read-answer from read_page line evidence", () => {
    const snap = workflowSnapshot({
      title: "Warehouse Counts",
      url: "https://example.test/warehouses",
      visibleContent:
        "Warehouse Beta Inventory count: 7318 units Warehouse Delta Inventory count: 2184 units Warehouse Gamma Inventory count: 4100 units",
      pageContent: "Warehouse Counts",
      elements: [
        rowElement(811, "Warehouse Beta Inventory count: 7318 units"),
        rowElement(812, "Warehouse Delta Inventory count: 2184 units"),
        rowElement(813, "Warehouse Gamma Inventory count: 4100 units"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest:
        "What is the difference between the highest and lowest inventory count across warehouses?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nWarehouse Beta Inventory count: 7318 units\nWarehouse Delta Inventory count: 2184 units\nWarehouse Gamma Inventory count: 4100 units\nThe page compares warehouse inventory counts, receiving backlog, audit timing, and replenishment notes so operators can answer warehouse metric range questions from visible row evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "5134",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "inventory count range",
      expectedAnswerScope: "aggregate",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:aggregate-text:",
    );
  });

  test("does not generate row metric-range read-answer from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Warehouse Counts",
      url: "https://example.test/warehouses",
      visibleContent:
        "Warehouse Counts Warehouse Beta Inventory count is 7318 units Warehouse Delta Inventory count is 2184 units Warehouse Gamma Inventory count is 4100 units",
      pageContent:
        "Warehouse Counts Warehouse Beta Inventory count is 7318 units Warehouse Delta Inventory count is 2184 units Warehouse Gamma Inventory count is 4100 units. The page compares warehouse inventory counts, receiving backlog, audit timing, and replenishment notes so operators can answer warehouse metric range questions from visible row evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "What is the range of inventory count across warehouses?",
      snapshot: snap,
    });

    expect(generated).toBeNull();
  });

  test("does not generate row metric-range read-answer with only one row candidate", () => {
    const snap = workflowSnapshot({
      title: "Warehouse Counts",
      url: "https://example.test/warehouses",
      visibleContent: "Warehouse Beta Inventory count: 7318 units",
      pageContent: "Warehouse Counts",
      elements: [rowElement(811, "Warehouse Beta Inventory count: 7318 units")],
    });
    const generated = generateCompletionContract({
      userRequest: "What is the range of inventory count across warehouses?",
      snapshot: snap,
    });

    expect(generated).toBeNull();
  });

  test("accepts row metric-highest read-answer from visible row elements", () => {
    const snap = workflowSnapshot({
      title: "Warehouse Counts",
      url: "https://example.test/warehouses",
      visibleContent:
        "Warehouse Beta Inventory count: 7318 units Warehouse Delta Inventory count: 2184 units",
      pageContent: "Warehouse Counts",
      elements: [
        rowElement(811, "Warehouse Beta Inventory count: 7318 units"),
        rowElement(812, "Warehouse Delta Inventory count: 2184 units"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "What is the highest inventory count across warehouses?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "The highest inventory count is 7318.",
    });
    const wrongHighest = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "The highest inventory count is 2184.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "inventory count highest",
      expectedAnswerScope: "aggregate",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:aggregate:",
    );
    expect(wrongHighest.status).toBe("inconclusive");
  });

  test("accepts row metric-lowest read-answer from read_page line evidence", () => {
    const snap = workflowSnapshot({
      title: "Warehouse Counts",
      url: "https://example.test/warehouses",
      visibleContent:
        "Warehouse Beta Inventory count: 7318 units Warehouse Delta Inventory count: 2184 units",
      pageContent: "Warehouse Counts",
      elements: [
        rowElement(811, "Warehouse Beta Inventory count: 7318 units"),
        rowElement(812, "Warehouse Delta Inventory count: 2184 units"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "What is the minimum inventory count across warehouses?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nWarehouse Beta Inventory count: 7318 units\nWarehouse Delta Inventory count: 2184 units\nThe page compares warehouse inventory counts, receiving backlog, audit timing, and replenishment notes so operators can answer warehouse metric extreme-value questions from visible row evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "2184",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "inventory count lowest",
      expectedAnswerScope: "aggregate",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:aggregate-text:",
    );
  });

  test("does not generate row metric-highest read-answer from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Warehouse Counts",
      url: "https://example.test/warehouses",
      visibleContent:
        "Warehouse Counts Warehouse Beta Inventory count is 7318 units Warehouse Delta Inventory count is 2184 units",
      pageContent:
        "Warehouse Counts Warehouse Beta Inventory count is 7318 units Warehouse Delta Inventory count is 2184 units. The page compares warehouse inventory counts, receiving backlog, audit timing, and replenishment notes so operators can answer warehouse metric extreme-value questions from visible row evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "What is the highest inventory count across warehouses?",
      snapshot: snap,
    });

    expect(generated).toBeNull();
  });

  test("does not generate row metric-lowest read-answer with only one row candidate", () => {
    const snap = workflowSnapshot({
      title: "Warehouse Counts",
      url: "https://example.test/warehouses",
      visibleContent: "Warehouse Beta Inventory count: 7318 units",
      pageContent: "Warehouse Counts",
      elements: [rowElement(811, "Warehouse Beta Inventory count: 7318 units")],
    });
    const generated = generateCompletionContract({
      userRequest: "What is the lowest inventory count across warehouses?",
      snapshot: snap,
    });

    expect(generated).toBeNull();
  });

});
