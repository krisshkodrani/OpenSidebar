import { describe, expect, test } from "vitest";
import "../setup";
import {
  AGENT_ACTION_IDLE_MS,
  AGENT_STEP_SETTLE_MS,
  deriveAgentCueTransition,
} from "../../src/content/agent-cue";

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

  test("shows a short-lived cue for running steps", () => {
    expect(
      deriveAgentCueTransition({
        sessionActive: true,
        stepStatus: "running",
      }),
    ).toEqual({
      showCue: true,
      hideAfterMs: AGENT_ACTION_IDLE_MS,
      borderState: "active",
    });
  });

  test("keeps the cue briefly for done and error states", () => {
    expect(
      deriveAgentCueTransition({
        sessionActive: true,
        stepStatus: "done",
      }),
    ).toEqual({
      showCue: true,
      hideAfterMs: AGENT_STEP_SETTLE_MS,
      borderState: "settle",
    });

    expect(
      deriveAgentCueTransition({
        sessionActive: true,
        stepStatus: "error",
      }),
    ).toEqual({
      showCue: true,
      hideAfterMs: AGENT_STEP_SETTLE_MS,
      borderState: "settle",
    });
  });
});
