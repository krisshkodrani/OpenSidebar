import { describe, expect, test } from "vitest";
import "../setup";
import { TurnState } from "../../src/background/agent/turn-state";
import { ToolName } from "../../src/types";

describe("TurnState", () => {
  test("initializes the five run-scoped collections empty", () => {
    const s = new TurnState();
    expect(s.toolFailCounts.size).toBe(0);
    expect(s.recentSuccesses).toEqual([]);
    expect(s.recentToolCalls).toEqual([]);
    expect(s.discoveredTagIds.size).toBe(0);
    expect(s.resultPageProgress).toBeTruthy();
  });

  test("resetRecentSuccesses clears in place (reference stays valid)", () => {
    const s = new TurnState();
    const ref = s.recentSuccesses;
    ref.push({} as never);
    expect(s.recentSuccesses.length).toBe(1);
    s.resetRecentSuccesses();
    expect(ref.length).toBe(0); // same array cleared in place
    expect(s.recentSuccesses).toBe(ref);
  });

  test("resetStepScopedActionMemory clears recent tool calls + successes", () => {
    const s = new TurnState();
    s.recentToolCalls.push({ tool: ToolName.CLICK_ELEMENT, argsKey: "a" });
    s.recentSuccesses.push({} as never);
    s.resetStepScopedActionMemory();
    expect(s.recentToolCalls.length).toBe(0);
    expect(s.recentSuccesses.length).toBe(0);
  });
});
