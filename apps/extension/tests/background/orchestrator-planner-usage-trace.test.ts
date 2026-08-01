import { describe, expect, test } from "vitest";
import { protectPlannerTraceResponse } from "../../src/background/orchestrator/planner-usage-trace";

describe("planner usage trace protection", () => {
  test("redacts common sensitive values and bounds stored responses", () => {
    const protectedResponse = protectPlannerTraceResponse(
      `Contact person@example.com with sk-${"a".repeat(20)}. ${"x".repeat(40_000)}`,
    );

    expect(protectedResponse).not.toContain("person@example.com");
    expect(protectedResponse).not.toContain(`sk-${"a".repeat(20)}`);
    expect(protectedResponse).toContain("[REDACTED_EMAIL]");
    expect(protectedResponse).toContain("sk-[REDACTED]");
    expect(protectedResponse.length).toBeLessThan(33_000);
    expect(protectedResponse).toContain("[TRUNCATED");
  });
});
