import { describe, expect, test } from "vitest";
import { buildStepStatuses } from "../../src/trace-viewer/components/traces/PlanTab";

const steps = [
  { objective: "Step A", dependencies: [] },
  { objective: "Step B", dependencies: [] },
];

function planMonitor(stepIndex: number, alignment: string) {
  return { type: "plan_monitor", data: { stepIndex, alignment } };
}

describe("buildStepStatuses", () => {
  test("accumulates the turn range across plan_monitor events for a step", () => {
    const entries = [
      { turnNumber: 2, events: [planMonitor(0, "progressing")] },
      { turnNumber: 5, events: [planMonitor(0, "aligned")] },
      { turnNumber: 4, events: [planMonitor(0, "progressing")] },
    ];

    const result = buildStepStatuses(steps, entries as any);

    expect(result[0].turnRange).toEqual({ start: 2, end: 5 });
    // Alignment is last-write-wins in entry order; the final step-0 event is
    // "progressing", so the step is in-progress regardless of turn ordering.
    expect(result[0].status).toBe("in-progress");
    expect(result[0].alignment).toBe("progressing");
  });

  test("uses the last alignment in entry order for a step's status", () => {
    const entries = [
      { turnNumber: 1, events: [planMonitor(0, "progressing")] },
      { turnNumber: 2, events: [planMonitor(0, "aligned")] },
    ];

    const result = buildStepStatuses(steps, entries as any);

    // Last event for step 0 is "aligned" -> completed.
    expect(result[0].status).toBe("completed");
    expect(result[0].turnRange).toEqual({ start: 1, end: 2 });
  });

  test("ignores entries with a non-numeric turnNumber (no NaN range)", () => {
    const entries = [
      { turnNumber: undefined, events: [planMonitor(0, "progressing")] },
      { turnNumber: 3, events: [planMonitor(0, "aligned")] },
    ];

    const result = buildStepStatuses(steps, entries as any);

    expect(result[0].turnRange).toEqual({ start: 3, end: 3 });
    expect(Number.isNaN(result[0].turnRange?.start as number)).toBe(false);
    expect(Number.isNaN(result[0].turnRange?.end as number)).toBe(false);
  });

  test("leaves turnRange undefined for steps with no plan_monitor events", () => {
    const entries = [{ turnNumber: 1, events: [planMonitor(0, "aligned")] }];

    const result = buildStepStatuses(steps, entries as any);

    expect(result[1].turnRange).toBeUndefined();
  });
});
