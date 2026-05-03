import { describe, expect, test } from "vitest";
import {
  assessBlindToolCallReasoning,
  INITIAL_BLIND_TOOL_CALL_MESSAGE,
  REPEAT_BLIND_TOOL_CALL_MESSAGE,
} from "../../src/background/agent/blind-tool-call-policy";

describe("blind tool call policy", () => {
  test("increments blind tool turns without nudging before threshold", () => {
    expect(
      assessBlindToolCallReasoning({
        cleanContent: null,
        toolsRecoveredFromText: false,
        hadThinking: false,
        consecutiveBlindToolTurns: 1,
      }),
    ).toEqual({
      consecutiveBlindToolTurns: 2,
      nudge: null,
      message: null,
    });
  });

  test("nudges on the third blind tool turn", () => {
    expect(
      assessBlindToolCallReasoning({
        cleanContent: null,
        toolsRecoveredFromText: false,
        hadThinking: false,
        consecutiveBlindToolTurns: 2,
      }),
    ).toEqual({
      consecutiveBlindToolTurns: 3,
      nudge: "initial",
      message: INITIAL_BLIND_TOOL_CALL_MESSAGE,
    });
  });

  test("repeats nudge every six blind tool turns", () => {
    expect(
      assessBlindToolCallReasoning({
        cleanContent: null,
        toolsRecoveredFromText: false,
        hadThinking: false,
        consecutiveBlindToolTurns: 5,
      }),
    ).toEqual({
      consecutiveBlindToolTurns: 6,
      nudge: "repeat",
      message: REPEAT_BLIND_TOOL_CALL_MESSAGE,
    });
  });

  test("resets when content, recovered text, or thinking is present", () => {
    for (const args of [
      { cleanContent: "Reasoning", toolsRecoveredFromText: false, hadThinking: false },
      { cleanContent: null, toolsRecoveredFromText: true, hadThinking: false },
      { cleanContent: null, toolsRecoveredFromText: false, hadThinking: true },
    ]) {
      expect(
        assessBlindToolCallReasoning({
          ...args,
          consecutiveBlindToolTurns: 4,
        }),
      ).toEqual({
        consecutiveBlindToolTurns: 0,
        nudge: null,
        message: null,
      });
    }
  });
});
