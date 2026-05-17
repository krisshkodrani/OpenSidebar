import { describe, expect, test } from "vitest";
import "../setup";
import {
  deriveAgentCueTransition,
  deriveAgentOperationActivity,
  INITIAL_AGENT_ACTIVITY_SIGNAL_STATE,
  reduceAgentActivitySignal,
  type AgentActivitySignalEvent,
  type AgentActivitySignalState,
} from "../../src/content/agent-cue";

function applyEvents(events: AgentActivitySignalEvent[]): {
  state: AgentActivitySignalState;
  accepted: boolean[];
} {
  let state = INITIAL_AGENT_ACTIVITY_SIGNAL_STATE;
  const accepted: boolean[] = [];

  for (const event of events) {
    const reduction = reduceAgentActivitySignal(state, event);
    accepted.push(reduction.accepted);
    state = reduction.state;
  }

  return { state, accepted };
}

describe("agent cue transitions", () => {
  test("does not show the cue when the session is not active", () => {
    expect(
      deriveAgentCueTransition({
        sessionActive: false,
        stepStatus: "running",
      }),
    ).toEqual({
      showCue: false,
      hideAfterMs: null,
      borderState: null,
    });
  });

  test("keeps the cue visible for running steps while the session is active", () => {
    expect(
      deriveAgentCueTransition({
        sessionActive: true,
        stepStatus: "running",
      }),
    ).toEqual({
      showCue: true,
      hideAfterMs: null,
      borderState: "active",
    });
  });

  test("keeps the cue active for done and error states while the session is active", () => {
    expect(
      deriveAgentCueTransition({
        sessionActive: true,
        stepStatus: "done",
      }),
    ).toEqual({
      showCue: true,
      hideAfterMs: null,
      borderState: "active",
    });

    expect(
      deriveAgentCueTransition({
        sessionActive: true,
        stepStatus: "error",
      }),
    ).toEqual({
      showCue: true,
      hideAfterMs: null,
      borderState: "active",
    });
  });

  test("keeps operation activity active until the task session ends", () => {
    expect(
      deriveAgentOperationActivity({
        taskActive: true,
        stepStatus: "done",
      }),
    ).toEqual({
      active: true,
      status: "Running",
      outcome: "",
    });

    expect(
      deriveAgentOperationActivity({
        taskActive: false,
        stepStatus: "done",
      }),
    ).toEqual({
      active: false,
      status: "Done",
      outcome: "completed",
    });
  });

  test("keeps rail and cue active between follow-up step-local completions", () => {
    const { state, accepted } = applyEvents([
      { type: "activity", active: true, pageActivity: true },
      { type: "step", status: "running" },
      { type: "step", status: "done" },
      { type: "step", status: "running" },
      { type: "activity", active: false, outcome: { status: "completed" } },
    ]);

    expect(accepted).toEqual([true, true, true, true, true]);
    expect(state).toEqual({
      sessionActive: false,
      pageActivityActive: false,
      rail: { active: false, status: "Done", outcome: "completed" },
    });
  });

  test("recovers from a step-local error without marking the task failed", () => {
    let state = INITIAL_AGENT_ACTIVITY_SIGNAL_STATE;

    for (const event of [
      { type: "activity", active: true, pageActivity: true },
      { type: "step", status: "running" },
      { type: "step", status: "error" },
    ] satisfies AgentActivitySignalEvent[]) {
      state = reduceAgentActivitySignal(state, event).state;
    }

    expect(state).toEqual({
      sessionActive: true,
      pageActivityActive: true,
      rail: { active: true, status: "Running", outcome: "" },
    });

    const result = applyEvents([
      { type: "activity", active: true, pageActivity: true },
      { type: "step", status: "running" },
      { type: "step", status: "error" },
      { type: "step", status: "running" },
      { type: "step", status: "done" },
      { type: "activity", active: false, outcome: { status: "completed" } },
    ]);

    expect(result.state.rail).toEqual({
      active: false,
      status: "Done",
      outcome: "completed",
    });
  });

  test("ignores stale step messages before start and after completion", () => {
    const beforeStart = applyEvents([{ type: "step", status: "running" }]);

    expect(beforeStart.accepted).toEqual([false]);
    expect(beforeStart.state).toEqual(INITIAL_AGENT_ACTIVITY_SIGNAL_STATE);

    const afterCompletion = applyEvents([
      { type: "activity", active: true, pageActivity: true },
      { type: "activity", active: false, outcome: { status: "completed" } },
      { type: "step", status: "running" },
    ]);

    expect(afterCompletion.accepted).toEqual([true, true, false]);
    expect(afterCompletion.state.rail).toEqual({
      active: false,
      status: "Done",
      outcome: "completed",
    });
  });

  test("does not let duplicate active messages downgrade page activity", () => {
    const { state, accepted } = applyEvents([
      { type: "activity", active: true, pageActivity: true },
      { type: "activity", active: true, pageActivity: false },
    ]);

    expect(accepted).toEqual([true, true]);
    expect(state).toEqual({
      sessionActive: true,
      pageActivityActive: true,
      rail: { active: true, status: "Running", outcome: "" },
    });
  });

  test("ignores outcomes on active messages and duplicate terminal messages", () => {
    const malformedActive = applyEvents([
      {
        type: "activity",
        active: true,
        pageActivity: true,
        outcome: { status: "failed" },
      },
    ]);

    expect(malformedActive.state.rail).toEqual({
      active: true,
      status: "Running",
      outcome: "",
    });

    const duplicateTerminal = applyEvents([
      { type: "activity", active: true, pageActivity: true },
      { type: "activity", active: false, outcome: { status: "completed" } },
      { type: "activity", active: false, outcome: { status: "failed" } },
    ]);

    expect(duplicateTerminal.accepted).toEqual([true, true, false]);
    expect(duplicateTerminal.state.rail).toEqual({
      active: false,
      status: "Done",
      outcome: "completed",
    });
  });
});
