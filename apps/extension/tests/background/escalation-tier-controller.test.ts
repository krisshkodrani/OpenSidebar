import { describe, expect, test, vi } from "vitest";
import "../setup";
import {
  EscalationTierController,
  type EscalationTierControllerHost,
} from "../../src/background/agent/escalation-tier-controller";
import { ESCALATION_LIMITS, DEFAULT_RUNTIME_LIMITS } from "../../src/background/agent/constants";

function makeHost(
  overrides: Partial<EscalationTierControllerHost> = {},
): EscalationTierControllerHost {
  return {
    limits: DEFAULT_RUNTIME_LIMITS,
    getTurn: () => 0,
    deescalateModel: vi.fn(async (_tabId: number, prev: number) => prev + 100),
    addHandoffMessage: vi.fn(),
    emitInfoStep: vi.fn(),
    logInfo: vi.fn(),
    isStillStuck: vi.fn(() => false),
    broadcastProgressResolved: vi.fn(),
    addDeescalationMessage: vi.fn(),
    resetStagnationEscalation: vi.fn(),
    ...overrides,
  };
}

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

  test("onTurnStart: decrements cooldown and holds tier while orienting", async () => {
    const host = makeHost({ getTurn: () => 1 });
    const esc = new EscalationTierController({
      startOnPlanner: true,
      orientationPhaseTurns: 2,
      host,
    });
    esc.cooldownRemaining = 3;
    const prev = await esc.onTurnStart({ tabId: 1, prevElementCount: 5 });
    expect(esc.cooldownRemaining).toBe(2); // ticked
    expect(esc.tier).toBe(1); // turn 1 <= orientation 2: no handoff yet
    expect(esc.orientationPhase).toBe(true);
    expect(prev).toBe(5); // deescalate not called
    expect(host.deescalateModel).not.toHaveBeenCalled();
  });

  test("onTurnStart: hands off tier 1→0 once orientation is exhausted", async () => {
    const host = makeHost({ getTurn: () => 3 });
    const esc = new EscalationTierController({
      startOnPlanner: true,
      orientationPhaseTurns: 2,
      host,
    });
    const prev = await esc.onTurnStart({ tabId: 1, prevElementCount: 5 });
    expect(esc.orientationPhase).toBe(false);
    expect(esc.tier).toBe(0);
    expect(esc.cooldownRemaining).toBe(host.limits.escalationCooldown);
    expect(prev).toBe(105); // deescalateModel returned prev+100
    expect(host.addHandoffMessage).toHaveBeenCalledOnce();
    expect(host.emitInfoStep).toHaveBeenCalledWith("Handing off to executor model");
  });

  test("recordProgressSignal: not stuck just resets the progress gate", async () => {
    const host = makeHost();
    const esc = new EscalationTierController({
      startOnPlanner: true,
      orientationPhaseTurns: 2,
      host,
    });
    esc.wasStuck = false;
    esc.consecutiveProgressSignals = 2;
    const prev = await esc.recordProgressSignal({
      snapUrl: "x",
      tabId: 1,
      prevElementCount: 7,
    });
    expect(esc.consecutiveProgressSignals).toBe(0);
    expect(prev).toBe(7);
    expect(host.deescalateModel).not.toHaveBeenCalled();
  });

  test("recordProgressSignal: de-escalates after PROGRESS_GATE clean signals", async () => {
    const host = makeHost({ getTurn: () => 999, isStillStuck: vi.fn(() => false) });
    const esc = new EscalationTierController({
      startOnPlanner: true,
      orientationPhaseTurns: 2,
      host,
    });
    esc.tier = 1;
    esc.wasStuck = true;
    esc.plannerModelStartTurn = 0; // tenure 999 >> MIN_PLANNER_TENURE
    let prev = 3;
    for (let i = 0; i < ESCALATION_LIMITS.PROGRESS_GATE; i++) {
      esc.wasStuck = true; // gate clears wasStuck on the final signal
      prev = await esc.recordProgressSignal({
        snapUrl: "x",
        tabId: 1,
        prevElementCount: prev,
      });
    }
    expect(esc.tier).toBe(0); // de-escalated
    expect(esc.escalationCycles).toBe(1);
    expect(host.addDeescalationMessage).toHaveBeenCalled();
    expect(host.emitInfoStep).toHaveBeenCalledWith(
      "Progress made — switching back to executor model",
    );
  });

  test("recordProgressSignal: still-stuck resets the gate without de-escalating", async () => {
    const host = makeHost({ getTurn: () => 999, isStillStuck: vi.fn(() => true) });
    const esc = new EscalationTierController({
      startOnPlanner: true,
      orientationPhaseTurns: 2,
      host,
    });
    esc.tier = 1;
    esc.wasStuck = true;
    esc.consecutiveProgressSignals = ESCALATION_LIMITS.PROGRESS_GATE - 1;
    await esc.recordProgressSignal({ snapUrl: "x", tabId: 1, prevElementCount: 1 });
    expect(esc.consecutiveProgressSignals).toBe(0); // reset, gate not reached
    expect(esc.tier).toBe(1);
    expect(host.deescalateModel).not.toHaveBeenCalled();
  });
});
