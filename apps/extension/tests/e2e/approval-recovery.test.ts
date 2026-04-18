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
  sendApprovalResponse,
  seedPendingInteraction,
  updateUserSettings,
  waitForMonitoredEvent,
  waitForTaskCompletion,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";

const h = createE2EHarness({ maxTurns: 24, testLabel: "approval-recovery" });

describe.skipIf(!h.apiKey)("E2E: Approval Recovery", () => {
  beforeAll(async () => {
    await h.beforeAllHook();
    await updateUserSettings(h.ctx, {
      allowNavigation: true,
      requireApprovals: true,
    });
  }, 60_000);

  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("approval-recovery"));
  afterAll(() => h.afterAllHook());

  it("re-emits a pending approval after extension reload and resumes on the same approval id", async () => {
    await navigateAndWait(h.page, getFixtureUrl("procurement"));
    await h.page.bringToFront();

    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const seeded = await seedPendingInteraction(h.ctx, {
      tabId,
      interaction: {
        kind: "approval",
        toolName: "create_tab",
        args: { url: "https://example.test/?store=techdirect" },
        context: "Open the TechDirect store link in a new tab.",
      },
    });
    const workspaceId = seeded.workspaceId;

    const initialApproval = await waitForMonitoredEvent(
      h.ctx.serviceWorker,
      (event) => event.type === "APPROVAL_REQUEST",
      240_000,
      workspaceId,
    );

    expect(initialApproval.approvalId).toBeTruthy();
    expect(initialApproval.payload?.toolName).toBe("create_tab");
    expect(initialApproval.context).toContain("TechDirect");

    await restartExtensionAndMonitor(h.ctx);
    await resyncWorkspace(h.ctx, workspaceId);

    const recoveredApproval = await waitForMonitoredEvent(
      h.ctx.serviceWorker,
      (event) => event.type === "APPROVAL_REQUEST",
      120_000,
      workspaceId,
    );

    expect(seeded.interactionId).toBe(initialApproval.approvalId);
    expect(recoveredApproval.approvalId).toBe(initialApproval.approvalId);
    expect(recoveredApproval.payload?.toolName).toBe("create_tab");

    await sendApprovalResponse(
      h.ctx,
      recoveredApproval.approvalId,
      true,
      workspaceId,
    );

    const outcome = await waitForTaskCompletion(h.ctx, 60_000, workspaceId);

    if (!outcome.ok) {
      console.log(
        "[approval-recovery] FAILURE:",
        JSON.stringify(
          { reason: outcome.reason, events: outcome.events.slice(-12) },
          null,
          2,
        ),
      );
    }

    expect(outcome.ok, outcome.reason).toBe(true);
    const completion = [...outcome.events]
      .reverse()
      .find((event) => event.type === "TASK_COMPLETION");
    expect(completion?.payload?.summary).toContain("approved");
    expect(completion?.payload?.summary).toContain("create_tab");

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 120_000);
});
