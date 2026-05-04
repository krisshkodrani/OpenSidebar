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
import { openTraceViewerPage } from "./helpers/browser";
import {
  createDurableTaskRun,
  upsertDurableTaskRunNode,
  upsertDurableTaskRunProgress,
  waitForBackendHealthy,
  waitForTaskRun,
} from "./helpers/backend";
import {
  getActiveTabId,
  navigateAndWait,
  restartExtensionAndMonitor,
  resyncWorkspace,
  waitForTaskCompletion,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";

const h = createE2EHarness({
  maxTurns: 10,
  testLabel: "structured-progress-resume",
});
const RUN_BACKEND_DURABLE_E2E = process.env.E2E_BACKEND_DURABLE === "true";

describe.skipIf(!h.apiKey || !RUN_BACKEND_DURABLE_E2E)(
  "E2E: Structured Progress Resume",
  () => {
    beforeAll(() => h.beforeAllHook(), 60_000);
    afterAll(() => h.afterAllHook());

    beforeEach(async () => {
      await h.beforeEachHook();
      expect(
        await waitForBackendHealthy(),
        "Backend must be running for structured progress resume E2E",
      ).toBe(true);
    });

    afterEach(() => h.afterEachHook("structured-progress-resume"));

    it("shows structured progress in durable run detail and resumes a synthesis step from recovered facts", async () => {
      await navigateAndWait(h.page, getFixtureUrl("job-board"));
      await h.page.bringToFront();

      const tabId = await getActiveTabId(h.ctx.serviceWorker);
      expect(tabId).toBeGreaterThan(0);

      const unique = crypto.randomUUID().slice(0, 8);
      const workspaceId = `e2e-structured-progress-${unique}`;
      const runId = `run-structured-progress-${unique}`;
      const query =
        "Based on the already reviewed job listings, recommend the single best match for a remote frontend engineer profile using only the recovered findings.";

      await createDurableTaskRun({
        id: runId,
        clientRunId: `task-structured-progress-${unique}`,
        workspaceId,
        query,
        rootTabId: tabId,
        checkpointSummary: {
          currentIndex: 0,
          nodeCount: 1,
          turnNumber: 1,
          activeNodeId: "compare-1",
        },
      });

      await upsertDurableTaskRunNode(runId, "compare-1", {
        description:
          "Compare the already reviewed job listings and recommend the best single match using the recovered findings.",
        successCriteria:
          "Return the best match and why based only on the recovered reviewed findings.",
        selectedSkillId: "cross-tab-compare",
        selectedSkillReason:
          "Recovered evidence is already available; synthesize instead of reopening pages.",
        allowedTools: ["read_page", "done"],
        status: "running",
      });

      await upsertDurableTaskRunProgress(runId, {
        key: "completed-phases",
        kind: "completed-phase-list",
        payload: [
          "Reviewed Frontend Tech Lead",
          "Reviewed Senior Frontend Engineer",
          "Reviewed Platform UI Manager",
        ],
      });

      await upsertDurableTaskRunProgress(runId, {
        key: "reviewed-items",
        kind: "reviewed-item-list",
        payload: [
          "Frontend Tech Lead",
          "Senior Frontend Engineer",
          "Platform UI Manager",
        ],
      });

      await upsertDurableTaskRunProgress(runId, {
        key: "extracted-facts",
        kind: "extracted-fact-map",
        payload: {
          "Frontend Tech Lead":
            "fully remote, React/TypeScript, $170k-$190k, leadership-heavy people management",
          "Senior Frontend Engineer":
            "fully remote, React/TypeScript, $145k-$165k, hands-on individual contributor role",
          "Platform UI Manager":
            "hybrid, UI platform management, less hands-on frontend coding",
          "User preference":
            "prefers remote hands-on frontend work over management responsibilities",
        },
      });

      const durableRun = await waitForTaskRun(
        workspaceId,
        (run) => run.id === runId && run.status === "running",
        15_000,
      );
      expect(durableRun, "Seeded durable run should be visible before opening the trace viewer").not.toBeNull();

      const viewer = await openTraceViewerPage(h.ctx);
      await viewer.waitForFunction(
        (expectedWorkspaceId) => document.body.innerText.includes(expectedWorkspaceId),
        {},
        workspaceId,
      );

      await viewer.evaluate((expectedWorkspaceId) => {
        const runButton = Array.from(document.querySelectorAll("button")).find(
          (candidate) => candidate.textContent?.includes(expectedWorkspaceId),
        ) as HTMLButtonElement | undefined;
        if (!runButton) {
          throw new Error(`Durable run button not found for ${expectedWorkspaceId}`);
        }
        runButton.click();
      }, workspaceId);
      await viewer.waitForFunction(() => {
        const text = document.body.innerText.toLowerCase();
        return (
          text.includes("structured progress") &&
          text.includes("senior frontend engineer") &&
          text.includes("user preference")
        );
      });
      await viewer.evaluate(() => {
        const resumeButton = Array.from(document.querySelectorAll("button")).find(
          (candidate) => candidate.textContent?.trim() === "Request resume",
        ) as HTMLButtonElement | undefined;
        if (!resumeButton) {
          throw new Error("Request resume button not found");
        }
        resumeButton.click();
      });
      await viewer.waitForFunction(() =>
        document.body.innerText.toLowerCase().includes("resume requested"),
      );
      await viewer.close();

      await restartExtensionAndMonitor(h.ctx);
      await resyncWorkspace(h.ctx, workspaceId);

      const outcome = await waitForTaskCompletion(h.ctx, 180_000, workspaceId);
      await h.printTraceSummary(workspaceId);

      if (!outcome.ok) {
        console.log(
          "[structured-progress-resume] FAILURE:",
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
      const summary = String(completion?.payload?.summary ?? "");
      expect(summary).toContain("Senior Frontend Engineer");
    }, 240_000);
  },
);
