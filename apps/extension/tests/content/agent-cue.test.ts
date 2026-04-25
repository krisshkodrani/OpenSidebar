import { describe, expect, test } from "vitest";
import "../setup";
import { deriveAgentCueTransition } from "../../src/content/agent-cue";

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

  test("keeps the cue visible for done and error states while the session is active", () => {
    expect(
      deriveAgentCueTransition({
        sessionActive: true,
        stepStatus: "done",
      }),
    ).toEqual({
      showCue: true,
      hideAfterMs: null,
      borderState: "settle",
    });

    expect(
      deriveAgentCueTransition({
        sessionActive: true,
        stepStatus: "error",
      }),
    ).toEqual({
      showCue: true,
      hideAfterMs: null,
      borderState: "settle",
    });
  });
});
