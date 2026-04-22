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
  clearLocalCheckpointsForWorkspace,
  getActiveTabId,
  navigateAndWait,
  restartExtensionAndMonitor,
  resyncWorkspace,
  seedPendingInteraction,
  sendApprovalResponse,
  waitForLocalCheckpointPersisted,
  waitForMonitoredEvent,
  waitForTaskCompletion,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";
import { waitForBackendHealthy, waitForTaskRun } from "./helpers/backend";
import { updateUserSettings } from "./helpers/utils";

const h = createE2EHarness({
  maxTurns: 24,
  testLabel: "backend-durable-resume",
});
const RUN_BACKEND_DURABLE_E2E = process.env.E2E_BACKEND_DURABLE === "true";

describe.skipIf(!h.apiKey || !RUN_BACKEND_DURABLE_E2E)(
  "E2E: Backend Durable Resume",
  () => {
    beforeAll(async () => {
      await h.beforeAllHook();
      await updateUserSettings(h.ctx, {
        allowNavigation: true,
        requireApprovals: false,
      });
    }, 60_000);

    beforeEach(async () => {
      await h.beforeEachHook();
      expect(
        await waitForBackendHealthy(),
        "Backend must be running for backend durable resume E2E",
      ).toBe(true);
    });

    afterEach(() => h.afterEachHook("backend-durable-resume"));
    afterAll(() => h.afterAllHook());

    it("recovers a pending approval from backend durable state after local checkpoints are deleted", async () => {
      await navigateAndWait(h.page, getFixtureUrl("procurement"));
      await h.page.bringToFront();

      const tabId = await getActiveTabId(h.ctx.serviceWorker);
      expect(tabId).toBeGreaterThan(0);

      const seeded = await seedPendingInteraction(h.ctx, {
        tabId,
        interaction: {
          kind: "approval",
          toolName: "create_tab",
          args: { url: getFixtureUrl("procurement") + "?store=techdirect" },
          context: "Open the TechDirect store link in a new tab.",
        },
      });
      const workspaceId = seeded.workspaceId;

      const initialApproval = await waitForMonitoredEvent(
        h.ctx.serviceWorker,
        (event) => event.type === "APPROVAL_REQUEST",
        120_000,
        workspaceId,
      );
      expect(initialApproval.approvalId).toBe(seeded.interactionId);

      await waitForLocalCheckpointPersisted(h.ctx, workspaceId);

      const durableRun = await waitForTaskRun(
        workspaceId,
        (run) => run.status === "running" || run.status === "planning",
        12_000,
      );
      expect(
        durableRun,
        "Durable run should be visible in the backend before local checkpoints are cleared",
      ).not.toBeNull();

      await clearLocalCheckpointsForWorkspace(h.ctx, workspaceId);
      await restartExtensionAndMonitor(h.ctx);
      await resyncWorkspace(h.ctx, workspaceId);

      const recoveredApproval = await waitForMonitoredEvent(
        h.ctx.serviceWorker,
        (event) => event.type === "APPROVAL_REQUEST",
        60_000,
        workspaceId,
      );

      expect(recoveredApproval.approvalId).toBe(initialApproval.approvalId);
      expect(recoveredApproval.payload?.toolName).toBe("create_tab");

      await sendApprovalResponse(
        h.ctx,
        recoveredApproval.approvalId,
        true,
        workspaceId,
      );

      const outcome = await waitForTaskCompletion(h.ctx, 300_000, workspaceId);
      await h.printTraceSummary(workspaceId);

      if (!outcome.ok) {
        console.log(
          "[backend-durable-resume] FAILURE:",
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
      expect(String(completion?.payload?.summary ?? "")).toContain("approved");

      await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
    }, 420_000);
  },
);
