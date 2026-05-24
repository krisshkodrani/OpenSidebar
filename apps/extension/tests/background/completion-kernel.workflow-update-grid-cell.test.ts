import { describe, expect, test } from "vitest";
import "../setup";
import {
  deriveCompletionEvidenceFromSnapshot,
  evaluateCompletionContract,
  generateCompletionContract,
} from "../../src/background/agent/completion-kernel";
import type { DomSnapshot, TaggedElement } from "../../src/types";

function cell(tag: number, text: string): TaggedElement {
  return {
    tag,
    tagName: "td",
    role: "gridcell",
    text,
    attributes: {},
    rect: { x: 0, y: tag * 24, width: 80, height: 24 },
    isVisible: true,
    isDisabled: false,
  };
}

function snapshot(overrides: Partial<DomSnapshot> = {}): DomSnapshot {
  return {
    title: "Spreadsheet Editor",
    url: "https://example.test/sheet",
    visibleContent: "",
    pageContent:
      "Product\n\nQ1 Sales\n\nQ2 Sales\n\nQ3 Sales\n\nWidget A\n\n999\n\n160\n\n190\n\nCell: Q1 Sales row 1",
    elements: [
      {
        tag: 49,
        tagName: "table",
        role: "grid",
        text: "ProductQ1 SalesQ2 SalesQ3 SalesWidget A999160190Widget B180210240",
        attributes: { role: "grid" },
        rect: { x: 0, y: 0, width: 650, height: 226 },
        isVisible: true,
        isDisabled: false,
      },
      cell(144, "Widget A"),
      cell(166, "999"),
      cell(146, "160"),
      cell(147, "190"),
    ],
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    ...overrides,
  };
}

describe("completion kernel workflow update grid cell state", () => {
  test("accepts a committed spreadsheet cell value from visible grid cells", () => {
    const snap = snapshot({
      pageContent: "Cell: Q1 Sales row 1",
    });
    const generated = generateCompletionContract({
      userRequest:
        "In the spreadsheet, change the Q1 Sales value in the first row to 999.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 6);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "Successfully changed the Q1 Sales value in the first row (Widget A) to 999. The spreadsheet now displays 999 in the Q1 Sales column for Widget A, and no inline editor is active.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "update",
      targetLabel: "Q1 Sales value",
      targetValue: "999",
    });
    expect(decision).toMatchObject({
      status: "accepted",
      reason: "Update contract is satisfied by visible target value state.",
    });
  });

  test("binds inline-edit pronoun objectives to the edited grid cell", () => {
    const snap = snapshot({
      pageContent: "Cell: Q1 Sales row 1",
    });
    const generated = generateCompletionContract({
      userRequest:
        "In the spreadsheet, change the Q1 Sales value in the first row to 999.",
      activeObjective:
        "Click the Q1 Sales cell in the first row and change its value to 999",
      successCriteria:
        "The subtask outcome for \"Click the Q1 Sales cell in the first row and change its value to 999\" is verified on the page or in tool output.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "Successfully changed the Q1 Sales value in the first row (Widget A) from 130 to 999. The edit was committed and is now visible in the spreadsheet table.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "update",
      targetLabel: "Q1 Sales cell",
      targetValue: "999",
    });
    expect(decision.status).toBe("accepted");
  });
  test("falls back past meta success criteria when active objective has no direct update target", () => {
    const activeObjective =
      "Click the Q1 Sales cell in the first data row, type 999, and press Enter to confirm the change";
    const snap = snapshot({
      pageContent: "Spreadsheet saved! (1 edit(s) applied) Cell: Q1 Sales row 1",
    });
    const generated = generateCompletionContract({
      userRequest:
        "In the spreadsheet, change the Q1 Sales value in the first row to 999.",
      activeObjective,
      successCriteria: `The subtask outcome for "${activeObjective}" is verified on the page or in tool output.`,
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 8);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "Successfully changed the Q1 Sales value in the first data row (Widget A) from 130 to 999. The edit was committed by pressing Enter, and the spreadsheet now displays 999 in that cell.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "update",
      targetLabel: "Q1 Sales cell",
      targetValue: "999",
    });
    expect(decision.status).toBe("accepted");
  });
  test("does not accept a same-value inline editor as committed grid state", () => {
    const snap = snapshot({
      pageContent:
        "Product\n\nQ1 Sales\n\nQ2 Sales\n\nQ3 Sales\n\nWidget A\n\n160\n\n190\n\nCell: Q1 Sales row 1 (editing)",
      elements: [
        {
          tag: 165,
          tagName: "input",
          role: "textbox",
          text: "999",
          attributes: {
            type: "text",
            value: "999",
            "aria-label": "Q1 Sales editor",
          },
          rect: { x: 80, y: 24, width: 76, height: 20 },
          isVisible: true,
          isDisabled: false,
        },
        {
          tag: 49,
          tagName: "table",
          role: "grid",
          text: "ProductQ1 SalesQ2 SalesQ3 SalesWidget A160190Widget B180210240",
          attributes: { role: "grid" },
          rect: { x: 0, y: 0, width: 650, height: 226 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    });
    const generated = generateCompletionContract({
      userRequest:
        "In the spreadsheet, change the Q1 Sales value in the first row to 999.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 6);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "The Q1 Sales editor contains 999, and the cell is still being edited.",
    });

    expect(decision.status).not.toBe("accepted");
  });
});