import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { createE2EHarness } from "./helpers/harness";
import {
  assertNoGhostSession,
  getActiveTabId,
  navigateAndWait,
  sendUserChat,
  waitForOutcome,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";
import {
  collectFormTraceMetrics,
  traceFilesContainText,
} from "./helpers/diagnostics";

const h = createE2EHarness({
  maxTurns: 30,
  testLabel: "vendor-onboarding-wizard",
});

const expectedRequest = {
  fullName: "Maya Patel",
  email: "maya.patel@example.com",
  phone: "+1 415 555 0198",
  requestType: "Consulting partner",
  department: "Finance",
  vendorName: "Northstar Analytics",
  dataAccess: "Customer data",
  accessReason: "Customer onboarding dashboards and account analytics",
  dpaCompleted: true,
  confirmAccuracy: true,
  reviewPath: "Enhanced review",
  submitted: true,
};

describe.skipIf(!h.apiKey)("E2E: Vendor Onboarding Wizard", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  afterAll(() => h.afterAllHook());

  beforeEach(async () => {
    await h.beforeEachHook();
  });

  afterEach(async () => {
    await h.afterEachHook("vendor-onboarding-wizard");
  });

  it("completes a multi-step conditional form and submits after review", async () => {
    await navigateAndWait(h.page, getFixtureUrl("vendor-onboarding"));
    await h.page.bringToFront();
    await expect
      .poll(
        () =>
          h.page.evaluate(() => {
            const draft = (window as any).vendorOnboardingDraft;
            return draft
              ? {
                  step: draft.step,
                  submitted: draft.submitted,
                  conditionalCount: draft.visibleConditionalFields?.length ?? 0,
                }
              : null;
          }),
        { timeout: 5_000 },
      )
      .toEqual({ step: 1, submitted: false, conditionalCount: 0 });

    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt =
      "Submit a vendor access request for Maya Patel. Use maya.patel@example.com and +1 415 555 0198. " +
      "The vendor is Northstar Analytics, a consulting partner for Finance. They need customer data for Customer onboarding dashboards and account analytics. " +
      "Mark the data processing agreement as completed, confirm the review details, and submit the request.";

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () =>
        (await h.page.evaluate(
          (expected) => {
            const result = (window as any).vendorOnboardingResult;
            if (!result) return null;
            const matches = Object.entries(expected).every(
              ([key, value]) => result[key] === value,
            );
            return matches ? result : null;
          },
          expectedRequest,
        )) || null,
      360_000,
      workspaceId,
    );

    const { traceFiles } = await h.printTraceSummary(workspaceId);

    expect(outcome.ok, outcome.reason).toBe(true);
    expect(outcome.result).toMatchObject(expectedRequest);

    const eventSummary = await h.page.evaluate(() => {
      const events = (window as any).vendorOnboardingResult?.events ?? [];
      return {
        changedSteps: events.filter((event: any) => event.type === "step_changed")
          .length,
        submitted: events.some((event: any) => event.type === "submitted"),
      };
    });
    expect(eventSummary).toEqual({ changedSteps: 2, submitted: true });
    expect(traceFilesContainText(traceFiles, "multi-step-form-wizard")).toBe(true);
    expect(traceFilesContainText(traceFiles, "Customer data")).toBe(true);

    const formMetrics = collectFormTraceMetrics(traceFiles, {
      requiredFieldCount: 8,
      expectedStepTransitions: 3,
      conditionalFieldLabels: ["Access reason", "Data processing agreement"],
      reviewText: "Review",
      confirmationText: "Request submitted",
      submitted: true,
    });
    expect(formMetrics.outcome).toEqual({
      filledRequiredFields: true,
      handledConditionalFields: true,
      advancedAllSteps: true,
      verifiedReview: true,
      submitted: true,
      detectedConfirmation: true,
    });
    expect(formMetrics.finalSubmitConfidence).toBe(1);
    console.log("[vendor-onboarding] Form metrics:", formMetrics);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 480_000);
});
