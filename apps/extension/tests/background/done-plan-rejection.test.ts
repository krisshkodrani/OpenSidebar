import { describe, expect, test, vi } from "vitest";
import "../setup";
import {
  runDonePlanRejection,
  type DonePlanRejectionHost,
} from "../../src/background/agent/done-plan-rejection";

/**
 * Characterization coverage for the done-against-active-plan rejection policy
 * (RFC LP-16 Phase 3 relocation). This path was previously buried in loop() and
 * had no direct unit coverage; these tests pin its current behavior so the
 * eventual pipeline-absorption (Phase 2 tail) has a golden baseline to verify
 * against. They assert the CURRENT behavior — they are not a spec change.
 */

type HostOverrides = Partial<DonePlanRejectionHost>;

function makeHost(over: HostOverrides = {}): DonePlanRejectionHost {
  const host: DonePlanRejectionHost = {
    planSteps: [{}] as unknown as DonePlanRejectionHost["planSteps"],
    stepRetryCount: 0,
    consecutiveAutoAdvances: 0,
    doneRejections: 0,
    guardAfterDoneRejection: false,
    turnCount: 5,
    limits: { maxDoneRejections: 3 } as DonePlanRejectionHost["limits"],
    planSubtasks: [
      { status: "running", description: "Step one" },
    ] as unknown as DonePlanRejectionHost["planSubtasks"],
    context: {
      addMessage: vi.fn(),
      getSnapshot: vi.fn(() => null),
    } as unknown as DonePlanRejectionHost["context"],
    traceRecorder: {
      recordEvent: vi.fn(),
    } as unknown as DonePlanRejectionHost["traceRecorder"],
    log: {
      info: vi.fn(),
      warn: vi.fn(),
    } as unknown as DonePlanRejectionHost["log"],
    syncPlanStatus: vi.fn(),
    broadcastTaskProgress: vi.fn(),
    checkAndSetDoneRejectionEscalation: vi.fn(),
    doneRejectionDiagnosticContent: vi.fn(() => "DIAGNOSTIC"),
    stepHandler: vi.fn(),
    ...over,
  };
  return host;
}

describe("runDonePlanRejection — retry_step branch", () => {
  test("nudges and increments stepRetryCount without counting a rejection", () => {
    const host = makeHost({
      planSteps: [
        { verifyAfter: { action: "retry_step", maxRetries: 8, trigger: "new rows" } },
      ] as unknown as DonePlanRejectionHost["planSteps"],
      stepRetryCount: 0,
    });

    runDonePlanRejection(host, "tc-1", "Loaded more rows", "Verifier: not done", 0);

    expect(host.stepRetryCount).toBe(1);
    expect(host.doneRejections).toBe(0); // retry does NOT count a rejection
    expect(host.context.addMessage).toHaveBeenCalledTimes(1);
    const msg = (host.context.addMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(msg.content).toContain("attempt 1/8");
    expect(host.checkAndSetDoneRejectionEscalation).not.toHaveBeenCalled();
  });

  test("falls through to normal rejection once retries are exhausted", () => {
    const host = makeHost({
      planSteps: [
        { verifyAfter: { action: "retry_step", maxRetries: 2, trigger: "new rows" } },
      ] as unknown as DonePlanRejectionHost["planSteps"],
      stepRetryCount: 2, // already at the cap
    });

    runDonePlanRejection(host, "tc-2", "Loaded more rows", "Verifier: not done", 0);

    // Retry exhausted → real rejection path runs.
    expect(host.stepRetryCount).toBe(2); // not incremented past the cap
    expect(host.doneRejections).toBe(1);
    expect(host.guardAfterDoneRejection).toBe(true);
    expect(host.checkAndSetDoneRejectionEscalation).toHaveBeenCalledTimes(1);
    expect(host.stepHandler).toHaveBeenCalledTimes(1);
  });
});

describe("runDonePlanRejection — reject branch", () => {
  test("a non-plan-incomplete reason rejects: counts, guards, diagnoses", () => {
    const host = makeHost({ doneRejections: 0 });

    runDonePlanRejection(host, "tc-3", "I clicked submit", "Verifier rejected", 0);

    expect(host.doneRejections).toBe(1);
    expect(host.guardAfterDoneRejection).toBe(true);
    expect(host.checkAndSetDoneRejectionEscalation).toHaveBeenCalledTimes(1);
    expect(host.doneRejectionDiagnosticContent).toHaveBeenCalledTimes(1);
    expect(host.context.addMessage).toHaveBeenCalledTimes(1);
    const msg = (host.context.addMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(msg.content).toBe("DIAGNOSTIC");
    expect(host.stepHandler).toHaveBeenCalledTimes(1);
    expect(host.syncPlanStatus).not.toHaveBeenCalled(); // no auto-advance
  });

  test("blocks done after max rejections without further stepHandler churn", () => {
    const host = makeHost({ doneRejections: 2 }); // becomes 3 == max

    runDonePlanRejection(host, "tc-4", "still not done", "Verifier rejected", 0);

    expect(host.doneRejections).toBe(3);
    expect(host.context.addMessage).toHaveBeenCalledTimes(1);
    // At the cap the policy emits the blocked-diagnostic and returns before
    // the step-handler "Not done yet" info event.
    expect(host.stepHandler).not.toHaveBeenCalled();
  });
});
