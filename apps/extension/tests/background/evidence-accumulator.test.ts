import { describe, expect, test } from "vitest";
import "../setup";
import { EvidenceAccumulator } from "../../src/background/agent/evidence";
import { ToolName } from "../../src/types";

describe("EvidenceAccumulator", () => {
  test("adds trusted typed evidence and deduplicates equivalent events", () => {
    const accumulator = new EvidenceAccumulator();
    const event = {
      type: "submit_succeeded" as const,
      source: ToolName.CONFIGURE_SERVICENOW_FORM,
      confidence: "high" as const,
      observedAt: "2026-05-01T00:00:00.000Z",
      supportsTaskGoal: true,
      detail: { recordNumber: "INC0010001" },
    };

    expect(accumulator.add(event)).toBe(true);
    expect(accumulator.add({ ...event, observedAt: "2026-05-01T00:00:01.000Z" })).toBe(false);
    expect(accumulator.hasType("submit_succeeded")).toBe(true);
    expect(accumulator.getByType("submit_succeeded")).toHaveLength(1);
  });

  test("tracks uncertainty as a conflict signal", () => {
    const accumulator = new EvidenceAccumulator();
    accumulator.add({
      type: "uncertainty_detected",
      source: ToolName.CONFIGURE_SERVICENOW_FORM,
      confidence: "high",
      observedAt: "2026-05-01T00:00:00.000Z",
      supportsTaskGoal: false,
      detail: { reason: "same_create_form_after_submit" },
    });

    expect(accumulator.hasConflict()).toBe(true);
  });
});

