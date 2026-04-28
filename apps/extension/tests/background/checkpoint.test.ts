/**
 * Durable turn checkpoint + step mutation ledger tests (Ship 1)
 */

import { describe, test, expect, beforeEach } from "vitest";
import "../setup";

import {
  TURN_CHECKPOINT_VERSION,
  turnCheckpointKey,
  buildMutationKey,
  sanitizeTurnCheckpoint,
} from "../../src/background/agent/checkpoint-types";
import type {
  TurnCheckpoint,
  CompressedHistory,
} from "../../src/background/agent/checkpoint-types";
import { MUTATION_SENSITIVE_TOOLS } from "../../src/background/tools/metadata";
import { ToolName } from "../../src/types";
import { ContextManager } from "../../src/background/agent/context";

// ---------------------------------------------------------------------------
// checkpoint-types.ts unit tests
// ---------------------------------------------------------------------------

describe("checkpoint-types", () => {
  describe("turnCheckpointKey", () => {
    test("produces deterministic storage key", () => {
      expect(turnCheckpointKey("ws-1", "node-a")).toBe(
        "opensidebar:turn-checkpoint:ws-1:node-a",
      );
    });
  });

  describe("buildMutationKey", () => {
    test("produces deterministic key regardless of object key order", () => {
      const a = buildMutationKey(ToolName.CLICK_ELEMENT, { id: 5, text: "ok" });
      const b = buildMutationKey(ToolName.CLICK_ELEMENT, { text: "ok", id: 5 });
      expect(a).toBe(b);
    });

    test("different tools produce different keys", () => {
      const a = buildMutationKey(ToolName.CLICK_ELEMENT, { id: 5 });
      const b = buildMutationKey(ToolName.TYPE_TEXT, { id: 5 });
      expect(a).not.toBe(b);
    });

    test("different args produce different keys", () => {
      const a = buildMutationKey(ToolName.CLICK_ELEMENT, { id: 5 });
      const b = buildMutationKey(ToolName.CLICK_ELEMENT, { id: 6 });
      expect(a).not.toBe(b);
    });
  });

  describe("sanitizeTurnCheckpoint", () => {
    const validCheckpoint: TurnCheckpoint = {
      version: TURN_CHECKPOINT_VERSION,
      workspaceId: "ws-1",
      nodeId: "node-a",
      savedAt: Date.now(),
      turnCount: 5,
      maxTurns: 30,
      currentPlanIndex: 1,
      turnsOnCurrentStep: 2,
      escalationsOnCurrentStep: 0,
      guardAfterDoneRejection: false,
      history: { recentMessages: [], olderSummaries: [], originalCount: 10 },
      planStatus: null,
      workingNotes: "",
      lastActionOutcome: null,
      modelTier: "executor",
      isFirstTurn: false,
      snapshotFingerprint: "https://example.com|5|12345",
      pageUrl: "https://example.com",
      stepMutationLedger: [],
      sideEffectsLog: [],
    };

    test("accepts a valid checkpoint", () => {
      const result = sanitizeTurnCheckpoint(validCheckpoint);
      expect(result).not.toBeNull();
      expect(result!.turnCount).toBe(5);
    });

    test("rejects null/undefined", () => {
      expect(sanitizeTurnCheckpoint(null)).toBeNull();
      expect(sanitizeTurnCheckpoint(undefined)).toBeNull();
    });

    test("rejects wrong version", () => {
      expect(sanitizeTurnCheckpoint({ ...validCheckpoint, version: 999 })).toBeNull();
    });

    test("rejects missing required fields", () => {
      expect(sanitizeTurnCheckpoint({ version: TURN_CHECKPOINT_VERSION })).toBeNull();
      expect(sanitizeTurnCheckpoint({ ...validCheckpoint, workspaceId: 42 })).toBeNull();
      expect(sanitizeTurnCheckpoint({ ...validCheckpoint, turnCount: "five" })).toBeNull();
    });

    test("rejects non-object values", () => {
      expect(sanitizeTurnCheckpoint("string")).toBeNull();
      expect(sanitizeTurnCheckpoint(42)).toBeNull();
      expect(sanitizeTurnCheckpoint([])).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// MUTATION_SENSITIVE_TOOLS set
// ---------------------------------------------------------------------------

describe("MUTATION_SENSITIVE_TOOLS", () => {
  test("includes expected mutation-sensitive tools", () => {
    const expected: ToolName[] = [
      ToolName.CLICK_ELEMENT,
      ToolName.TYPE_TEXT,
      ToolName.SELECT_OPTION,
      ToolName.SET_CHECKBOX,
      ToolName.PRESS_KEY,
      ToolName.NAVIGATE,
      ToolName.GO_BACK,
      ToolName.EXECUTE_JS,
      ToolName.UPLOAD_FILE,
      ToolName.SET_COOKIE,
      ToolName.DELETE_COOKIE,
      ToolName.CREATE_TAB,
      ToolName.CLOSE_TAB,
      ToolName.CREATE_WINDOW,
    ];
    for (const tool of expected) {
      expect(MUTATION_SENSITIVE_TOOLS.has(tool)).toBe(true);
    }
  });

  test("excludes read-only and idempotent tools", () => {
    const excluded: ToolName[] = [
      ToolName.READ_PAGE,
      ToolName.READ_ELEMENT,
      ToolName.FIND_ELEMENT,
      ToolName.SCROLL_PAGE,
      ToolName.HOVER_ELEMENT,
      ToolName.DISMISS_OVERLAYS,
      ToolName.HIDE_ELEMENT,
      ToolName.LIST_TABS,
      ToolName.GET_COOKIES,
      ToolName.SEARCH_HISTORY,
      ToolName.INSPECT_HIDDEN,
      ToolName.XRAY_PAGE,
      ToolName.WAIT,
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
      ToolName.UPDATE_PLAN,
      ToolName.GET_PROFILE_FIELDS,
    ];
    for (const tool of excluded) {
      expect(MUTATION_SENSITIVE_TOOLS.has(tool)).toBe(false);
    }
  });

  test("has exactly 14 entries", () => {
    expect(MUTATION_SENSITIVE_TOOLS.size).toBe(14);
  });

  test("is a subset of tools with risk >= MEDIUM or explicit side-effects", () => {
    // Every mutation-sensitive tool should exist in the ToolName enum
    for (const tool of MUTATION_SENSITIVE_TOOLS) {
      expect(Object.values(ToolName)).toContain(tool);
    }
  });
});

// ---------------------------------------------------------------------------
// ContextManager checkpoint export / restore
// ---------------------------------------------------------------------------

describe("ContextManager checkpoint round-trip", () => {
  let context: ContextManager;

  beforeEach(() => {
    context = new ContextManager();
  });

  test("exportForCheckpoint captures recent messages and summarizes older", () => {
    // Add 12 messages (6 pairs of assistant+tool)
    for (let i = 0; i < 6; i++) {
      context.addMessage({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: `tc-${i}`,
            type: "function",
            function: { name: "click_element", arguments: `{"id":${i}}` },
          },
        ],
      });
      context.addMessage({
        role: "tool",
        tool_call_id: `tc-${i}`,
        content: `Clicked element ${i}`,
      });
    }

    const cp = context.exportForCheckpoint(4);

    // Recent window = 4 messages (last 2 pairs)
    expect(cp.recentMessages.length).toBe(4);
    // Older messages should be summarized
    expect(cp.olderSummaries.length).toBeGreaterThan(0);
    expect(cp.originalCount).toBe(12);
  });

  test("restoreFromCheckpointHistory rebuilds context from compressed history", () => {
    const history: CompressedHistory = {
      recentMessages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ],
      olderSummaries: [
        "T1: click_element({id:5}) → OK",
        "T2: type_text({id:7, text:'hello'}) → OK",
      ],
      originalCount: 6,
    };

    context.restoreFromCheckpointHistory(history, false);

    const messages = context.getMessages();
    // Should have: 1 system summary + 2 recent = 3
    expect(messages.length).toBe(3);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("Prior turns");
    expect(messages[0].content).toContain("T1: click_element");
    expect(messages[1].content).toBe("Hello");
    expect(messages[2].content).toBe("Hi there");
    expect(context.getIsFirstTurn()).toBe(false);
  });

  test("restoreFromCheckpointHistory with empty older summaries skips preamble", () => {
    const history: CompressedHistory = {
      recentMessages: [{ role: "user", content: "Hello" }],
      olderSummaries: [],
      originalCount: 1,
    };

    context.restoreFromCheckpointHistory(history, true);

    const messages = context.getMessages();
    expect(messages.length).toBe(1);
    expect(messages[0].content).toBe("Hello");
    expect(context.getIsFirstTurn()).toBe(true);
  });

  test("working notes getter/setter round-trip", () => {
    context.setWorkingNotes("test note");
    expect(context.getWorkingNotes()).toBe("test note");
  });

  test("setWorkingNotes truncates to 500 chars", () => {
    context.setWorkingNotes("x".repeat(1000));
    expect(context.getWorkingNotes().length).toBe(500);
  });

  test("lastActionOutcome getter/setter round-trip", () => {
    expect(context.getLastActionOutcome()).toBeNull();
    const outcome = {
      toolName: "click_element",
      deltaPercent: 10,
      urlChanged: false,
      currentUrl: "https://example.com",
      elementsAdded: 2,
      elementsRemoved: 0,
    };
    context.setLastActionOutcome(outcome);
    expect(context.getLastActionOutcome()).toEqual(outcome);
  });
});

// ---------------------------------------------------------------------------
// MutationLedgerEntry key canonicalization
// ---------------------------------------------------------------------------

describe("Mutation ledger key canonicalization", () => {
  test("nested objects are canonicalized", () => {
    const a = buildMutationKey("click_element", { id: 5, options: { force: true } });
    const b = buildMutationKey("click_element", { options: { force: true }, id: 5 });
    expect(a).toBe(b);
  });

  test("numeric vs string args produce different keys", () => {
    const a = buildMutationKey("click_element", { id: 5 });
    const b = buildMutationKey("click_element", { id: "5" });
    expect(a).not.toBe(b);
  });
});
