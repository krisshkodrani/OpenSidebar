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
  maxTurns: 28,
  testLabel: "partner-registration-validation",
});

const expectedRegistration = {
  fullName: "Sam Rivera",
  email: "sam.rivera@example.com",
  phone: "+1 415 555 0134",
  company: "Northstar Analytics",
  role: "Data analyst",
  team: "Customer Success",
  inviteCode: "PN-4821",
  termsAccepted: true,
  submitted: true,
};

describe.skipIf(!h.apiKey)("E2E: Partner Registration Validation", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  afterAll(() => h.afterAllHook());

  beforeEach(async () => {
    await h.beforeEachHook();
  });

  afterEach(async () => {
    await h.afterEachHook("partner-registration-validation");
  });

  it("recovers from inline validation errors and submits the registration", async () => {
    await navigateAndWait(h.page, getFixtureUrl("partner-registration"));
    await h.page.bringToFront();
    await expect
      .poll(
        () =>
          h.page.evaluate(() => {
            const draft = (window as any).partnerRegistrationDraft;
            return draft
              ? {
                  submitted: draft.submitted,
                  attemptCount: draft.attemptCount,
                  errorCount: Object.keys(draft.errors ?? {}).length,
                }
              : null;
          }),
        { timeout: 5_000 },
      )
      .toEqual({ submitted: false, attemptCount: 0, errorCount: 0 });

    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt =
      "Register Sam Rivera for the partner portal. Use sam.rivera@example.com, phone 415-555-0134, " +
      "company Northstar Analytics, role Data analyst, team Customer Success, and invite code pn-4821 exactly as provided. " +
      "Accept the partner terms and submit the registration.";

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () =>
        (await h.page.evaluate(
          (expected) => {
            const result = (window as any).partnerRegistrationResult;
            if (!result) return null;
            const matches = Object.entries(expected).every(
              ([key, value]) => result[key] === value,
            );
            return matches ? result : null;
          },
          expectedRegistration,
        )) || null,
      360_000,
      workspaceId,
    );

    const { traceFiles } = await h.printTraceSummary(workspaceId);

    expect(outcome.ok, outcome.reason).toBe(true);
    expect(outcome.result).toMatchObject(expectedRegistration);

    const eventSummary = await h.page.evaluate(() => {
      const events = (window as any).partnerRegistrationResult?.events ?? [];
      return {
        failedValidations: events.filter(
          (event: any) => event.type === "validation_failed",
        ).length,
        submitted: events.some((event: any) => event.type === "submitted"),
      };
    });
    expect(eventSummary.failedValidations).toBeGreaterThanOrEqual(1);
    expect(eventSummary.submitted).toBe(true);

    const formMetrics = collectFormTraceMetrics(traceFiles, {
      requiredFieldCount: 8,
      expectedStepTransitions: 2,
      validationErrorLabels: ["Phone must include a country code"],
      reviewText: "Registration received",
      confirmationText: "Registration received",
      submitted: true,
    });
    expect(formMetrics.validationErrorCount).toBeGreaterThanOrEqual(1);
    expect(formMetrics.failedSubmitCount).toBeGreaterThanOrEqual(1);
    expect(formMetrics.correctedFieldCount).toBeGreaterThanOrEqual(1);
    expect(formMetrics.recoverySuccess).toBe(true);
    expect(formMetrics.finalSubmitConfidence).toBe(1);
    expect(formMetrics.outcome.submitted).toBe(true);
    expect(formMetrics.outcome.detectedConfirmation).toBe(true);

    expect(traceFilesContainText(traceFiles, "structured-form-fill")).toBe(true);
    expect(traceFilesContainText(traceFiles, "Phone must include a country code")).toBe(true);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 480_000);
});
