import { describe, expect, test } from "vitest";
import {
  isTerminalResult,
  TURN_PHASE_ORDER,
  type TurnPhaseId,
} from "../../src/background/agent/turn-machine";

describe("turn-machine vocabulary", () => {
  test("phase order matches the measured loop() iteration order", () => {
    expect(TURN_PHASE_ORDER).toEqual([
      "gates",
      "escalation",
      "feedback",
      "prepare_model_turn",
      "dispatch_tools",
      "post_tool_guards",
      "plan_monitor",
      "completion",
      "account_and_refresh",
    ]);
  });

  test("account_and_refresh runs strictly after completion (phase-order pin)", () => {
    const idx = (id: TurnPhaseId) => TURN_PHASE_ORDER.indexOf(id);
    expect(idx("account_and_refresh")).toBeGreaterThan(idx("completion"));
    // and completion runs after the tool dispatch that can produce a done()
    expect(idx("completion")).toBeGreaterThan(idx("dispatch_tools"));
  });

  test("phase ids are unique", () => {
    expect(new Set(TURN_PHASE_ORDER).size).toBe(TURN_PHASE_ORDER.length);
  });

  test("isTerminalResult distinguishes terminal from advancing results", () => {
    expect(isTerminalResult({ kind: "end_turn" })).toBe(true);
    expect(
      isTerminalResult({ kind: "end_task", result: {} as never }),
    ).toBe(true);
    expect(isTerminalResult({ kind: "continue" })).toBe(false);
    expect(isTerminalResult({ kind: "skip_to", phase: "completion" })).toBe(
      false,
    );
  });
});
