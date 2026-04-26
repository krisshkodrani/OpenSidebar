import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { dirname, join } from "node:path";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createE2EHarness } from "./helpers/harness";
import {
  assertNoGhostSession,
  getActiveTabId,
  navigateAndWait,
  sendApprovalResponse,
  sendUserChat,
  waitForMonitoredEvent,
  waitForOutcome,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";
import { traceFilesContainText } from "./helpers/diagnostics";
import { waitForBackendHealthy } from "./helpers/backend";
import {
  seedTemporaryProfile,
  type SeededProfile,
} from "./helpers/profile";

const h = createE2EHarness({ maxTurns: 24, testLabel: "profile-job-application" });
const RUN_BACKEND_PROFILE_E2E = process.env.E2E_BACKEND_PROFILE === "true";

describe.skipIf(!h.apiKey || !RUN_BACKEND_PROFILE_E2E)(
  "E2E: Profile Job Application",
  () => {
    let seededProfile: SeededProfile | null = null;
    let seededCvPath: string | null = null;
    let originalCvContent: Buffer | null = null;

    beforeAll(() => h.beforeAllHook(), 60_000);
    afterAll(() => h.afterAllHook());

    beforeEach(async () => {
      await h.beforeEachHook();
      expect(
        await waitForBackendHealthy(),
        "Backend must be running for the profile job-application smoke",
      ).toBe(true);

      seededProfile = await seedTemporaryProfile({
        profile: {
          identity: {
            full_name: "Kai Schmidt",
            email: "kai.apply@example.com",
            phone: "+49 170 1234567",
          },
          files: {
            cv: {
              path: "cv.pdf",
              mime_type: "application/pdf",
            },
          },
          context: {
            safe: {
              professional_summary:
                "Senior frontend engineer focused on React, TypeScript, and browser automation.",
              job_preferences: {
                roles: ["Frontend Engineer", "Product Engineer"],
                remote: true,
              },
            },
          },
        },
      });
      seededCvPath = join(dirname(seededProfile.profilePath), "cv.pdf");
      try {
        originalCvContent = await readFile(seededCvPath);
      } catch (error: any) {
        if (error?.code !== "ENOENT") throw error;
        originalCvContent = null;
      }
      await writeFile(seededCvPath, "%PDF-1.4 fake e2e cv", "utf-8");
    });

    afterEach(async () => {
      if (seededCvPath) {
        if (originalCvContent) {
          await writeFile(seededCvPath, originalCvContent);
        } else {
          await rm(seededCvPath, { force: true });
        }
        seededCvPath = null;
        originalCvContent = null;
      }
      if (seededProfile) {
        await seededProfile.restore();
        seededProfile = null;
      }
      await h.afterEachHook("profile-job-application");
    });

    it("fills a job application, uploads the saved CV, and waits for submit approval", async () => {
      await navigateAndWait(h.page, getFixtureUrl("job-application"));
      await h.page.bringToFront();
      const tabId = await getActiveTabId(h.ctx.serviceWorker);
      expect(tabId).toBeGreaterThan(0);

      const prompt =
        "Apply to this job using my saved profile and CV. Ask me before submitting. " +
        "Use identity.full_name, identity.email, and identity.phone for exact form values.";

      const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

      const approval = await waitForMonitoredEvent(
        (h.ctx as any).serviceWorker,
        (event: any) =>
          event.type === "APPROVAL_REQUEST" &&
          /submit application/i.test(String(event.context ?? "")),
        300_000,
        workspaceId,
      );

      const draftState = await h.page.evaluate(() => ({
        fullName: (document.querySelector("#application-name") as HTMLInputElement)
          ?.value,
        email: (document.querySelector("#application-email") as HTMLInputElement)
          ?.value,
        phone: (document.querySelector("#application-phone") as HTMLInputElement)
          ?.value,
        cvName: (document.querySelector("#application-cv") as HTMLInputElement)
          ?.files?.[0]?.name,
        submitted: Boolean((window as any).jobApplicationResult),
      }));

      expect(draftState).toMatchObject({
        fullName: "Kai Schmidt",
        email: "kai.apply@example.com",
        phone: "+49 170 1234567",
        cvName: "cv.pdf",
        submitted: false,
      });

      await sendApprovalResponse(
        h.ctx,
        approval.approvalId,
        true,
        workspaceId,
      );

      const outcome = await waitForOutcome(
        h.page,
        h.ctx.serviceWorker,
        async () =>
          (await h.page.evaluate(() => (window as any).jobApplicationResult ?? null)) ||
          null,
        120_000,
        workspaceId,
      );

      const { traceFiles } = await h.printTraceSummary(workspaceId);

      expect(outcome.ok, outcome.reason).toBe(true);
      expect(outcome.result).toMatchObject({
        fullName: "Kai Schmidt",
        email: "kai.apply@example.com",
        phone: "+49 170 1234567",
        cvName: "cv.pdf",
        submitted: true,
      });
      expect(traceFilesContainText(traceFiles, "get_profile_fields")).toBe(true);
      expect(traceFilesContainText(traceFiles, "profileFile")).toBe(true);
      expect(traceFilesContainText(traceFiles, "PERSONAL CONTEXT")).toBe(true);

      await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
    }, 420_000);
  },
);
