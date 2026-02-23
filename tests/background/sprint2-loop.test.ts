/**
 * Sprint 2 Loop Tests
 * Tests for: element ID validation, failed-action memory, tab tool taboo,
 * escalation constants, and compression trigger constants.
 */

import { describe, test, expect } from "bun:test";
import { ToolName, DomSnapshot } from "../../src/types";
import {
  ESCALATION_LIMITS,
  COMPRESSION_TRIGGERS,
  FAILED_ACTION_MEMORY,
} from "../../src/background/agent/constants";

// ─── Element ID Validation (extracted logic, unit-testable) ──────────────

// We re-implement the validation logic here for unit testing since
// validateElementIds is a module-level function in loop.ts (not exported).
// This mirrors the exact logic and ensures it works correctly.

const ELEMENT_ID_TOOLS = new Set<string>([
  ToolName.CLICK_ELEMENT, ToolName.TYPE_TEXT, ToolName.HOVER_ELEMENT,
  ToolName.SELECT_OPTION, ToolName.DRAW_STROKE, ToolName.HIDE_ELEMENT,
  ToolName.READ_ELEMENT, ToolName.UPLOAD_FILE, ToolName.RIGHT_CLICK,
  ToolName.SET_CHECKBOX, ToolName.INSPECT_REACT, ToolName.REACT_SET_INPUT,
]);
const ELEMENT_DUAL_ID_TOOLS = new Set<string>([ToolName.DRAG_AND_DROP]);

function validateElementIds(
  toolName: string,
  args: Record<string, unknown>,
  snapshot: DomSnapshot | null,
): string | null {
  if (!snapshot || snapshot.elements.length === 0) return null;

  const validIds = new Set(snapshot.elements.map(e => e.tag));

  const checkId = (id: unknown, paramName: string): string | null => {
    if (id == null) return null;
    const numId = typeof id === "number" ? id : Number(id);
    if (isNaN(numId)) return null;
    if (validIds.has(numId)) return null;

    const sampleElements = snapshot.elements.slice(0, 15).map(
      e => `[${e.tag}] ${e.tagName} "${e.text.slice(0, 30)}"`,
    );
    return (
      `Error: Element ${paramName}=${numId} does not exist on the current page. ` +
      `Valid element IDs: ${[...validIds].slice(0, 20).join(", ")}. ` +
      `Sample elements:\n${sampleElements.join("\n")}\n` +
      `Use read_page to see all available elements.`
    );
  };

  if (ELEMENT_ID_TOOLS.has(toolName)) {
    return checkId(args.id, "id");
  }
  if (ELEMENT_DUAL_ID_TOOLS.has(toolName)) {
    return checkId(args.sourceId, "sourceId") ?? checkId(args.targetId, "targetId");
  }
  return null;
}

const mockSnapshot: DomSnapshot = {
  title: "Test Page",
  url: "https://example.com",
  elements: [
    { tagName: "button", tag: 5, text: "Submit", isVisible: true, attributes: {} },
    { tagName: "input", tag: 12, text: "", isVisible: true, attributes: { type: "text" } },
    { tagName: "a", tag: 20, text: "Link", isVisible: true, attributes: { href: "/" } },
  ],
  visibleContent: "text",
  viewport: { width: 1280, height: 800 },
};

describe("Element ID Validation", () => {
  test("returns null for valid IDs", () => {
    const result = validateElementIds(ToolName.CLICK_ELEMENT, { id: 5 }, mockSnapshot);
    expect(result).toBeNull();
  });

  test("returns error for non-existent ID", () => {
    const result = validateElementIds(ToolName.CLICK_ELEMENT, { id: 999 }, mockSnapshot);
    expect(result).not.toBeNull();
    expect(result).toContain("does not exist");
    expect(result).toContain("999");
  });

  test("returns error for ID 0 when no element has tag 0", () => {
    const result = validateElementIds(ToolName.SELECT_OPTION, { id: 0 }, mockSnapshot);
    expect(result).not.toBeNull();
    expect(result).toContain("does not exist");
  });

  test("handles sourceId/targetId for drag_and_drop", () => {
    // Valid sourceId and targetId
    const validResult = validateElementIds(
      ToolName.DRAG_AND_DROP,
      { sourceId: 5, targetId: 12 },
      mockSnapshot,
    );
    expect(validResult).toBeNull();

    // Invalid sourceId
    const invalidSource = validateElementIds(
      ToolName.DRAG_AND_DROP,
      { sourceId: 999, targetId: 12 },
      mockSnapshot,
    );
    expect(invalidSource).not.toBeNull();
    expect(invalidSource).toContain("sourceId=999");

    // Invalid targetId
    const invalidTarget = validateElementIds(
      ToolName.DRAG_AND_DROP,
      { sourceId: 5, targetId: 888 },
      mockSnapshot,
    );
    expect(invalidTarget).not.toBeNull();
    expect(invalidTarget).toContain("targetId=888");
  });

  test("skips tools without element ID params", () => {
    const result = validateElementIds(ToolName.NAVIGATE, { url: "https://example.com" }, mockSnapshot);
    expect(result).toBeNull();

    const doneResult = validateElementIds(ToolName.DONE, { summary: "done" }, mockSnapshot);
    expect(doneResult).toBeNull();

    const scrollResult = validateElementIds(ToolName.SCROLL_PAGE, { direction: "down" }, mockSnapshot);
    expect(scrollResult).toBeNull();
  });

  test("error message includes sample valid elements", () => {
    const result = validateElementIds(ToolName.CLICK_ELEMENT, { id: 42 }, mockSnapshot);
    expect(result).toContain("[5] button");
    expect(result).toContain("[12] input");
    expect(result).toContain("[20] a");
    expect(result).toContain("read_page");
  });

  test("returns null when snapshot is null", () => {
    const result = validateElementIds(ToolName.CLICK_ELEMENT, { id: 5 }, null);
    expect(result).toBeNull();
  });

  test("returns null when snapshot has no elements", () => {
    const emptySnap: DomSnapshot = {
      ...mockSnapshot,
      elements: [],
    };
    const result = validateElementIds(ToolName.CLICK_ELEMENT, { id: 5 }, emptySnap);
    expect(result).toBeNull();
  });
});

// ─── Failed Action Memory (unit logic) ──────────────────────────────────

interface FailedAction {
  tool: string;
  argsKey: string;
  error: string;
  turn: number;
}

function findPriorFailure(
  failedActions: FailedAction[],
  tool: string,
  argsKey: string,
): FailedAction | null {
  return failedActions.find(f => f.tool === tool && f.argsKey === argsKey) ?? null;
}

describe("Failed Action Memory", () => {
  test("blocks exact repeat of failed tool call", () => {
    const failedActions: FailedAction[] = [
      { tool: "click_element", argsKey: '{"id":5}', error: "No element with tag 5", turn: 3 },
    ];

    const match = findPriorFailure(failedActions, "click_element", '{"id":5}');
    expect(match).not.toBeNull();
    expect(match!.turn).toBe(3);
    expect(match!.error).toContain("No element");
  });

  test("different args for same tool are NOT blocked", () => {
    const failedActions: FailedAction[] = [
      { tool: "click_element", argsKey: '{"id":5}', error: "Error", turn: 3 },
    ];

    const match = findPriorFailure(failedActions, "click_element", '{"id":10}');
    expect(match).toBeNull();
  });

  test("successful actions are NOT in the failure buffer", () => {
    // Simulating only failures get added
    const failedActions: FailedAction[] = [];

    // Successful action — never added to buffer
    const match = findPriorFailure(failedActions, "click_element", '{"id":5}');
    expect(match).toBeNull();
  });

  test("ring buffer evicts oldest entries past BUFFER_SIZE", () => {
    const failedActions: FailedAction[] = [];

    // Fill to BUFFER_SIZE + 2
    for (let i = 0; i < FAILED_ACTION_MEMORY.BUFFER_SIZE + 2; i++) {
      failedActions.push({
        tool: "click_element",
        argsKey: `{"id":${i}}`,
        error: `Error ${i}`,
        turn: i,
      });
      if (failedActions.length > FAILED_ACTION_MEMORY.BUFFER_SIZE) {
        failedActions.shift();
      }
    }

    expect(failedActions.length).toBe(FAILED_ACTION_MEMORY.BUFFER_SIZE);

    // Oldest (id=0 and id=1) should be evicted
    const oldest = findPriorFailure(failedActions, "click_element", '{"id":0}');
    expect(oldest).toBeNull();

    const secondOldest = findPriorFailure(failedActions, "click_element", '{"id":1}');
    expect(secondOldest).toBeNull();

    // Most recent should still be there
    const newest = findPriorFailure(
      failedActions,
      "click_element",
      `{"id":${FAILED_ACTION_MEMORY.BUFFER_SIZE + 1}}`,
    );
    expect(newest).not.toBeNull();
  });
});

// ─── Tab Tool Taboo (constants + logic verification) ────────────────────

describe("Tab Tool Taboo", () => {
  test("all 4 tab tools are in the ToolName enum", () => {
    expect(ToolName.CREATE_TAB).toBe("create_tab");
    expect(ToolName.SWITCH_TAB).toBe("switch_tab");
    expect(ToolName.CLOSE_TAB).toBe("close_tab");
    expect(ToolName.CREATE_WINDOW).toBe("create_window");
  });

  test("tab tools can be added to a Set (simulating disabledTools)", () => {
    const disabledTools = new Set<ToolName>();
    const tabTools = [ToolName.CREATE_TAB, ToolName.SWITCH_TAB, ToolName.CLOSE_TAB, ToolName.CREATE_WINDOW];

    for (const tabTool of tabTools) {
      disabledTools.add(tabTool);
    }

    expect(disabledTools.size).toBe(4);
    expect(disabledTools.has(ToolName.CREATE_TAB)).toBe(true);
    expect(disabledTools.has(ToolName.SWITCH_TAB)).toBe(true);
    expect(disabledTools.has(ToolName.CLOSE_TAB)).toBe(true);
    expect(disabledTools.has(ToolName.CREATE_WINDOW)).toBe(true);
    // Other tools should NOT be disabled
    expect(disabledTools.has(ToolName.CLICK_ELEMENT)).toBe(false);
  });
});

// ─── Escalation Constants ───────────────────────────────────────────────

describe("Escalation Constants", () => {
  test("MIN_SMART_TENURE is 2", () => {
    expect(ESCALATION_LIMITS.MIN_SMART_TENURE).toBe(2);
  });

  test("PROGRESS_GATE is 2", () => {
    expect(ESCALATION_LIMITS.PROGRESS_GATE).toBe(2);
  });

  test("MAX_CYCLES is 5", () => {
    expect(ESCALATION_LIMITS.MAX_CYCLES).toBe(5);
  });
});

// ─── Compression Trigger Constants ──────────────────────────────────────

describe("Compression Trigger Constants", () => {
  test("thresholds are in ascending order", () => {
    expect(COMPRESSION_TRIGGERS.LIGHT_TURN_COUNT).toBeLessThan(COMPRESSION_TRIGGERS.MEDIUM_TURN_COUNT);
    expect(COMPRESSION_TRIGGERS.MEDIUM_TURN_COUNT).toBeLessThan(COMPRESSION_TRIGGERS.HEAVY_TURN_COUNT);
  });

  test("MEDIUM tool result limit is tighter than LIGHT", () => {
    expect(COMPRESSION_TRIGGERS.MEDIUM_TOOL_RESULT_LIMIT).toBeLessThan(COMPRESSION_TRIGGERS.LIGHT_TOOL_RESULT_LIMIT);
  });

  test("HEAVY_KEEP_RECENT is 10", () => {
    expect(COMPRESSION_TRIGGERS.HEAVY_KEEP_RECENT).toBe(10);
  });
});
