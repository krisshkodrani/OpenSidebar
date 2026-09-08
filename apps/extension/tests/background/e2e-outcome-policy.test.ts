import { describe, expect, test } from "vitest";
import { hasSettledSuccessfulOutcome } from "../e2e/helpers/outcome-policy";

describe("E2E outcome policy", () => {
  test.each(["completed", "partial", "failed", "stopped"])(
    "prefers observed success after %s completion",
    (completionStatus) => {
      expect(
        hasSettledSuccessfulOutcome({
          hasSuccessfulResult: true,
          completionStatus,
        }),
      ).toBe(true);
    },
  );

  test("waits while execution is still active", () => {
    expect(
      hasSettledSuccessfulOutcome({
        hasSuccessfulResult: true,
        agentStatus: "RUNNING",
      }),
    ).toBe(false);
  });

  test("never converts missing fixture evidence into success", () => {
    expect(
      hasSettledSuccessfulOutcome({
        hasSuccessfulResult: false,
        completionStatus: "completed",
      }),
    ).toBe(false);
  });
});
