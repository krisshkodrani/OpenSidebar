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
  restartExtensionAndMonitor,
  resyncWorkspace,
  sendClarificationResponse,
  seedPendingInteraction,
  updateUserSettings,
  waitForMonitoredEvent,
  waitForTaskCompletion,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";

const h = createE2EHarness({ maxTurns: 18, testLabel: "clarification-recovery" });

describe.skipIf(!h.apiKey)("E2E: Clarification Recovery", () => {
  beforeAll(async () => {
    await h.beforeAllHook();
    await updateUserSettings(h.ctx, {
      allowNavigation: false,
      requireApprovals: false,
    });
  }, 60_000);

  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("clarification-recovery"));
  afterAll(() => h.afterAllHook());

  it("re-emits a pending clarification after extension reload and resumes on the user answer", async () => {
    await navigateAndWait(h.page, getFixtureUrl("article"));
    await h.page.bringToFront();

    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const seeded = await seedPendingInteraction(h.ctx, {
      tabId,
      interaction: {
        kind: "clarification",
        question:
          "Two workspaces match. Which one should I continue with?",
        suggestions: ["Design Ops", "Platform"],
      },
    });
    const workspaceId = seeded.workspaceId;

    const initialClarification = await waitForMonitoredEvent(
      h.ctx.serviceWorker,
      (event) => event.type === "CLARIFICATION_REQUEST",
      120_000,
      workspaceId,
    );

    expect(initialClarification.clarificationId).toBeTruthy();
    expect(String(initialClarification.question ?? "")).toContain(
      "Which one should I continue with?",
    );

    await restartExtensionAndMonitor(h.ctx);
    await resyncWorkspace(h.ctx, workspaceId);

    const recoveredClarification = await waitForMonitoredEvent(
      h.ctx.serviceWorker,
      (event) => event.type === "CLARIFICATION_REQUEST",
      60_000,
      workspaceId,
    );

    expect(seeded.interactionId).toBe(initialClarification.clarificationId);
    expect(recoveredClarification.clarificationId).toBe(
      initialClarification.clarificationId,
    );
    expect(recoveredClarification.payload?.suggestions).toEqual([
      "Design Ops",
      "Platform",
    ]);

    await sendClarificationResponse(
      h.ctx,
      recoveredClarification.clarificationId,
      "Platform",
      workspaceId,
    );

    const outcome = await waitForTaskCompletion(h.ctx, 60_000, workspaceId);

    if (!outcome.ok) {
      console.log(
        "[clarification-recovery] FAILURE:",
        JSON.stringify(
          {
            reason: outcome.reason,
            events: outcome.events.slice(-12),
          },
          null,
          2,
        ),
      );
    }

    expect(outcome.ok, outcome.reason).toBe(true);
    const completion = [...outcome.events]
      .reverse()
      .find((event) => event.type === "TASK_COMPLETION");
    expect(completion?.payload?.summary).toContain("Platform");
    expect(completion?.payload?.summary).toContain("clarification");

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 120_000);
});
