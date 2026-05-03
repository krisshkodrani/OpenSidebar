import { describe, expect, it } from "vitest";

import { ACTION_EFFECT } from "../../src/background/agent/constants";
import {
  assessFailedActionRepeat,
  buildZeroEffectDecision,
} from "../../src/background/agent/loop-helpers";

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
