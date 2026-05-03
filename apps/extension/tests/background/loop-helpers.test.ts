import { describe, expect, it } from "vitest";

import { ACTION_EFFECT } from "../../src/background/agent/constants";
import {
  assessFailedActionRepeat,
  assessReadElementSameIdNudge,
  buildZeroEffectDecision,
} from "../../src/background/agent/loop-helpers";
import { ToolName } from "../../src/types";

describe("buildZeroEffectDecision", () => {
  it("warns on the first consecutive zero-effect turn", () => {
    const decision = buildZeroEffectDecision({
      consecutiveTurns: ACTION_EFFECT.WARNING_THRESHOLD,
      warningThreshold: ACTION_EFFECT.WARNING_THRESHOLD,
      escalateThreshold: ACTION_EFFECT.ESCALATE_THRESHOLD,
    });

    expect(decision.kind).toBe("warn");
    expect(decision.message).toContain("last action had no observable effect");
  });

  it("escalates on the second consecutive zero-effect turn", () => {
    const decision = buildZeroEffectDecision({
      consecutiveTurns: ACTION_EFFECT.ESCALATE_THRESHOLD,
      warningThreshold: ACTION_EFFECT.WARNING_THRESHOLD,
      escalateThreshold: ACTION_EFFECT.ESCALATE_THRESHOLD,
    });

    expect(decision.kind).toBe("escalate");
    expect(decision.message).toContain("Escalate or replan now");
  });

  it("includes the failure brief when one is available", () => {
    const decision = buildZeroEffectDecision({
      consecutiveTurns: ACTION_EFFECT.ESCALATE_THRESHOLD,
      failureBrief: "- click [12] Save\n- read_page()",
      warningThreshold: ACTION_EFFECT.WARNING_THRESHOLD,
      escalateThreshold: ACTION_EFFECT.ESCALATE_THRESHOLD,
    });

    expect(decision.kind).toBe("escalate");
    expect(decision.message).toContain("- click [12] Save");
    expect(decision.message).toContain("- read_page()");
  });
});

describe("assessFailedActionRepeat", () => {
  it("allows actions with no prior matching failure", () => {
    expect(
      assessFailedActionRepeat({
        blockedActions: [
          {
            tool: "click_element",
            argsKey: '{"id":1}',
            error: "Click failed",
            turn: 3,
          },
        ],
        tool: "click_element",
        argsKey: '{"id":2}',
      }),
    ).toBeNull();
  });

  it("blocks exact repeats of prior failed actions", () => {
    const decision = assessFailedActionRepeat({
      blockedActions: [
        {
          tool: "click_element",
          argsKey: '{"id":1}',
          error: "No element with tag 1",
          turn: 3,
        },
      ],
      tool: "click_element",
      argsKey: '{"id":1}',
    });

    expect(decision).toEqual({
      priorTurn: 3,
      message:
        "Error: This exact action already failed at turn 3 with: 'No element with tag 1'. " +
        "Suggestions: read_page to refresh element IDs, or find_element to locate by text.",
    });
  });
});

describe("assessReadElementSameIdNudge", () => {
  it("resets state for non-read_element tools", () => {
    expect(
      assessReadElementSameIdNudge({
        toolName: ToolName.CLICK_ELEMENT,
        args: { id: 1 },
        state: {
          lastReadElementId: 1,
          consecutiveReadElementSameId: 2,
        },
      }),
    ).toEqual({
      state: {
        lastReadElementId: null,
        consecutiveReadElementSameId: 0,
      },
      nudge: null,
    });
  });

  it("tracks a new read_element id without nudging", () => {
    expect(
      assessReadElementSameIdNudge({
        toolName: ToolName.READ_ELEMENT,
        args: { id: 2 },
        state: {
          lastReadElementId: 1,
          consecutiveReadElementSameId: 1,
        },
      }),
    ).toEqual({
      state: {
        lastReadElementId: 2,
        consecutiveReadElementSameId: 0,
      },
      nudge: null,
    });
  });

  it("allows the second read_element for the same id without nudging", () => {
    const decision = assessReadElementSameIdNudge({
      toolName: ToolName.READ_ELEMENT,
      args: { id: 7 },
      state: {
        lastReadElementId: 7,
        consecutiveReadElementSameId: 0,
      },
    });

    expect(decision).toEqual({
      state: {
        lastReadElementId: 7,
        consecutiveReadElementSameId: 1,
      },
      nudge: null,
    });
  });

  it("nudges on the third read_element for the same id", () => {
    expect(
      assessReadElementSameIdNudge({
        toolName: ToolName.READ_ELEMENT,
        args: { id: 7 },
        state: {
          lastReadElementId: 7,
          consecutiveReadElementSameId: 1,
        },
      }),
    ).toEqual({
      state: {
        lastReadElementId: 7,
        consecutiveReadElementSameId: 2,
      },
      nudge: {
        elementId: 7,
        consecutive: 3,
        message:
          "You have called read_element on element [7] 3 times. " +
          "Try a different approach: click_element to interact with it, read_page for full page context, or find_element to locate a different target.",
      },
    });
  });
});
