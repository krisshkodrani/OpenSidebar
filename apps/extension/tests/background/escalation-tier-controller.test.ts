import { describe, expect, test } from "vitest";
import "../setup";
import { EscalationTierController } from "../../src/background/agent/escalation-tier-controller";

describe("EscalationTierController", () => {
  test("plan-then-act default: starts on the planner tier in orientation", () => {
    const esc = new EscalationTierController({
      startOnPlanner: true,
      orientationPhaseTurns: 2,
    });
    expect(esc.tier).toBe(1);
    expect(esc.orientationPhase).toBe(true);
    expect(esc.effectiveOrientationTurns).toBe(2);
  });

  test("preferredModelTier=executor: starts on the executor tier, no orientation", () => {
    const esc = new EscalationTierController({
      startOnPlanner: false,
      orientationPhaseTurns: 2,
    });
    expect(esc.tier).toBe(0);
    expect(esc.orientationPhase).toBe(false);
  });

  test("counters and working memory start clean", () => {
    const esc = new EscalationTierController({
      startOnPlanner: true,
      orientationPhaseTurns: 2,
    });
    expect(esc.cooldownRemaining).toBe(0);
    expect(esc.escalationCycles).toBe(0);
    expect(esc.plannerModelStartTurn).toBe(0);
    expect(esc.consecutiveProgressSignals).toBe(0);
    expect(esc.freshStartCount).toBe(0);
    expect(esc.wasStuck).toBe(false);
    expect(esc.orientationToolsUsed.size).toBe(0);
  });
});
