import { describe, expect, it } from "vitest";
import { ESCALATION_RESCUE } from "../../src/background/agent/constants";
import {
  EscalationRescueTracker,
  type EscalationRescueAssessmentInput,
} from "../../src/background/agent/escalation-rescue-policy";

function input(
  overrides: Partial<EscalationRescueAssessmentInput> = {},
): EscalationRescueAssessmentInput {
  return {
    turn: 1,
    maxTurns: 30,
    escalationTier: 0,
    cooldownRemaining: 0,
    planSubtaskCount: 0,
    planCompletedCount: 0,
    ...overrides,
  };
}

describe("EscalationRescueTracker — no_progress trigger", () => {
  it("stays quiet while verified progress keeps arriving", () => {
    const tracker = new EscalationRescueTracker();
    for (let turn = 1; turn <= 20; turn++) {
      tracker.recordVerifiedProgress(turn, "new_url");
      expect(tracker.assess(input({ turn }))).toEqual({ kind: "none" });
    }
  });

  it("fires after NO_PROGRESS_TURNS without verified progress on no-plan runs", () => {
    const tracker = new EscalationRescueTracker();
    tracker.recordVerifiedProgress(2, "mutation");
    const quietUntil = 2 + ESCALATION_RESCUE.NO_PROGRESS_TURNS - 1;
    for (let turn = 3; turn <= quietUntil; turn++) {
      expect(tracker.assess(input({ turn }))).toEqual({ kind: "none" });
    }
    const fireTurn = 2 + ESCALATION_RESCUE.NO_PROGRESS_TURNS;
    const result = tracker.assess(input({ turn: fireTurn }));
    expect(result.kind).toBe("escalate");
    if (result.kind === "escalate") {
      expect(result.trigger).toBe("no_progress");
    }
  });

  it("does not fire when a plan exists (step watchdog owns planned runs)", () => {
    const tracker = new EscalationRescueTracker();
    expect(
      tracker.assess(input({ turn: 20, planSubtaskCount: 1 })),
    ).toEqual({ kind: "none" });
  });

  it("does not fire on the planner tier or during cooldown", () => {
    const tracker = new EscalationRescueTracker();
    expect(
      tracker.assess(input({ turn: 20, escalationTier: 1 })),
    ).toEqual({ kind: "none" });
    expect(
      tracker.assess(input({ turn: 20, cooldownRemaining: 2 })),
    ).toEqual({ kind: "none" });
  });

  it("every verified-progress kind resets the clock", () => {
    for (const kind of [
      "plan_step_advance",
      "mutation",
      "trusted_evidence",
      "new_url",
    ] as const) {
      const tracker = new EscalationRescueTracker();
      tracker.recordVerifiedProgress(10, kind);
      expect(tracker.assess(input({ turn: 12 }))).toEqual({ kind: "none" });
    }
  });

  it("user feedback resets the no-progress clock", () => {
    const tracker = new EscalationRescueTracker();
    tracker.noteUserIntervention(10);
    expect(tracker.assess(input({ turn: 12 }))).toEqual({ kind: "none" });
  });

  it("fires at most once per run", () => {
    const tracker = new EscalationRescueTracker();
    const fireTurn = ESCALATION_RESCUE.NO_PROGRESS_TURNS;
    expect(tracker.assess(input({ turn: fireTurn })).kind).toBe("escalate");
    // Window cleared by progress so trigger gating (not the window) decides.
    tracker.recordVerifiedProgress(fireTurn + 1, "new_url");
    expect(
      tracker.assess(input({ turn: fireTurn + 1 + 20 })).kind,
    ).not.toBe("escalate");
  });
});

describe("EscalationRescueTracker — budget_stall trigger", () => {
  it("fires when half the budget is gone with under half the plan complete", () => {
    const tracker = new EscalationRescueTracker();
    // Plan advance progress keeps no_progress quiet; plan gates the trigger.
    tracker.recordVerifiedProgress(14, "plan_step_advance");
    const result = tracker.assess(
      input({
        turn: 15,
        maxTurns: 30,
        planSubtaskCount: 4,
        planCompletedCount: 1,
      }),
    );
    expect(result.kind).toBe("escalate");
    if (result.kind === "escalate") {
      expect(result.trigger).toBe("budget_stall");
    }
  });

  it("stays quiet when plan completion keeps pace with the budget", () => {
    const tracker = new EscalationRescueTracker();
    tracker.recordVerifiedProgress(14, "plan_step_advance");
    expect(
      tracker.assess(
        input({
          turn: 15,
          maxTurns: 30,
          planSubtaskCount: 4,
          planCompletedCount: 2,
        }),
      ),
    ).toEqual({ kind: "none" });
  });

  it("stays quiet before the budget-fraction threshold", () => {
    const tracker = new EscalationRescueTracker();
    tracker.recordVerifiedProgress(13, "plan_step_advance");
    expect(
      tracker.assess(
        input({
          turn: 14,
          maxTurns: 30,
          planSubtaskCount: 4,
          planCompletedCount: 0,
        }),
      ),
    ).toEqual({ kind: "none" });
  });

  it("requires a multi-step plan", () => {
    const tracker = new EscalationRescueTracker();
    tracker.recordVerifiedProgress(19, "plan_step_advance");
    expect(
      tracker.assess(
        input({
          turn: 20,
          maxTurns: 30,
          planSubtaskCount: 1,
          planCompletedCount: 0,
        }),
      ),
    ).toEqual({ kind: "none" });
  });
});

describe("EscalationRescueTracker — efficacy guard", () => {
  it("fails fast when an escalation sees no verified progress in the window", () => {
    const tracker = new EscalationRescueTracker();
    tracker.noteEscalation(10, "step_watchdog");
    const lastQuiet = 10 + ESCALATION_RESCUE.EFFICACY_TURNS - 1;
    expect(
      tracker.assess(input({ turn: lastQuiet, escalationTier: 1 })),
    ).toEqual({ kind: "none" });
    const result = tracker.assess(
      input({
        turn: 10 + ESCALATION_RESCUE.EFFICACY_TURNS,
        escalationTier: 1,
      }),
    );
    expect(result.kind).toBe("fail_fast");
    expect(tracker.hasFailedFast).toBe(true);
  });

  it("closes the window as rescued when verified progress arrives", () => {
    const tracker = new EscalationRescueTracker();
    tracker.noteEscalation(10, "same_url");
    tracker.recordVerifiedProgress(12, "mutation");
    expect(
      tracker.assess(input({ turn: 30, escalationTier: 1 })).kind,
    ).not.toBe("fail_fast");
    const events = tracker.drainEvents();
    const outcome = events.find((e) => e.type === "escalation_outcome");
    expect(outcome?.data.outcome).toBe("rescued");
  });

  it("overlapping escalations share the original window", () => {
    const tracker = new EscalationRescueTracker();
    tracker.noteEscalation(10, "no_progress");
    tracker.noteEscalation(13, "done_rejection");
    const result = tracker.assess(
      input({
        turn: 10 + ESCALATION_RESCUE.EFFICACY_TURNS,
        escalationTier: 1,
      }),
    );
    expect(result.kind).toBe("fail_fast");
  });

  it("user feedback slides the efficacy window forward", () => {
    const tracker = new EscalationRescueTracker();
    tracker.noteEscalation(10, "voluntary");
    tracker.noteUserIntervention(14);
    expect(
      tracker.assess(
        input({
          turn: 10 + ESCALATION_RESCUE.EFFICACY_TURNS,
          escalationTier: 1,
        }),
      ),
    ).toEqual({ kind: "none" });
    const failTurn = 14 + ESCALATION_RESCUE.EFFICACY_TURNS;
    expect(
      tracker.assess(input({ turn: failTurn, escalationTier: 1 })).kind,
    ).toBe("fail_fast");
  });

  it("fail-fast fires once and silences all further assessment", () => {
    const tracker = new EscalationRescueTracker();
    tracker.noteEscalation(10, "step_watchdog");
    const failTurn = 10 + ESCALATION_RESCUE.EFFICACY_TURNS;
    expect(tracker.assess(input({ turn: failTurn })).kind).toBe("fail_fast");
    expect(tracker.assess(input({ turn: failTurn + 1 }))).toEqual({
      kind: "none",
    });
    expect(tracker.assess(input({ turn: failTurn + 30 }))).toEqual({
      kind: "none",
    });
  });
});

describe("EscalationRescueTracker — telemetry events", () => {
  it("queues escalation_triggered with progress-clock inputs", () => {
    const tracker = new EscalationRescueTracker();
    tracker.recordVerifiedProgress(3, "new_url");
    tracker.noteEscalation(9, "budget_stall");
    const events = tracker.drainEvents();
    const triggered = events.find((e) => e.type === "escalation_triggered");
    expect(triggered?.data).toMatchObject({
      trigger: "budget_stall",
      turn: 9,
      lastVerifiedProgressTurn: 3,
      turnsSinceVerifiedProgress: 6,
    });
  });

  it("drainEvents empties the queue", () => {
    const tracker = new EscalationRescueTracker();
    tracker.noteEscalation(5, "voluntary");
    expect(tracker.drainEvents().length).toBeGreaterThan(0);
    expect(tracker.drainEvents()).toEqual([]);
  });

  it("onLoopEnd resolves an open window as rescued on completion", () => {
    const tracker = new EscalationRescueTracker();
    tracker.noteEscalation(10, "step_watchdog");
    tracker.drainEvents();
    tracker.onLoopEnd(13, "completed");
    const outcome = tracker
      .drainEvents()
      .find((e) => e.type === "escalation_outcome");
    expect(outcome?.data.outcome).toBe("rescued");
    expect(outcome?.data.resolvedBy).toBe("completed");
  });

  it("onLoopEnd resolves an open window as budget_exhausted on max turns", () => {
    const tracker = new EscalationRescueTracker();
    tracker.noteEscalation(28, "same_url");
    tracker.drainEvents();
    tracker.onLoopEnd(30, "max_turns");
    const outcome = tracker
      .drainEvents()
      .find((e) => e.type === "escalation_outcome");
    expect(outcome?.data.outcome).toBe("budget_exhausted");
  });

  it("onLoopEnd is a no-op without an open window or for other outcomes", () => {
    const tracker = new EscalationRescueTracker();
    tracker.onLoopEnd(10, "max_turns");
    expect(tracker.drainEvents()).toEqual([]);
    tracker.noteEscalation(5, "voluntary");
    tracker.drainEvents();
    tracker.onLoopEnd(8, "other");
    expect(tracker.drainEvents()).toEqual([]);
  });

  it("reset clears all state", () => {
    const tracker = new EscalationRescueTracker();
    tracker.noteEscalation(5, "voluntary");
    tracker.recordVerifiedProgress(6, "mutation");
    tracker.reset();
    expect(tracker.drainEvents()).toEqual([]);
    expect(tracker.hasFailedFast).toBe(false);
    // Fresh clocks: no-progress trigger counts from turn 0 again.
    expect(
      tracker.assess(input({ turn: ESCALATION_RESCUE.NO_PROGRESS_TURNS })),
    ).toMatchObject({ kind: "escalate" });
  });
});
