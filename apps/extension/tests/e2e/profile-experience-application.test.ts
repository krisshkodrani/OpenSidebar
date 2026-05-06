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
import { traceFilesContainText } from "./helpers/diagnostics";
import { waitForBackendHealthy } from "./helpers/backend";
import {
  seedTemporaryProfile,
  type SeededProfile,
} from "./helpers/profile";

const h = createE2EHarness({
  maxTurns: 30,
  testLabel: "profile-experience-application",
});
const RUN_BACKEND_PROFILE_E2E = process.env.E2E_BACKEND_PROFILE === "true";

const expectedExperiences = [
  {
    company: "Atlas Labs",
    title: "Senior Frontend Engineer",
    startDate: "2022-04",
    endDate: "Present",
    summary: "Built React and TypeScript workflow tools for enterprise teams.",
  },
  {
    company: "Northstar Systems",
    title: "Frontend Engineer",
    startDate: "2019-06",
    endDate: "2022-03",
    summary:
      "Delivered customer dashboards with GraphQL and design-system components.",
  },
  {
    company: "BrightPixel Studio",
    title: "Web Developer",
    startDate: "2017-01",
    endDate: "2019-05",
    summary: "Created responsive web applications and automated content workflows.",
  },
];

describe.skipIf(!h.apiKey || !RUN_BACKEND_PROFILE_E2E)(
  "E2E: Profile Experience Application",
  () => {
    let seededProfile: SeededProfile | null = null;

    beforeAll(() => h.beforeAllHook(), 60_000);
    afterAll(() => h.afterAllHook());

    beforeEach(async () => {
      await h.beforeEachHook();
      expect(
        await waitForBackendHealthy(),
        "Backend must be running for the profile experience-application smoke",
      ).toBe(true);

      seededProfile = await seedTemporaryProfile({
        profile: {
          experience: {
            roles: expectedExperiences.map((entry) => ({
              company: entry.company,
              title: entry.title,
              start_date: entry.startDate,
              end_date: entry.endDate,
              summary: entry.summary,
            })),
          },
        },
      });
    });

    afterEach(async () => {
      if (seededProfile) {
        await seededProfile.restore();
        seededProfile = null;
      }
      await h.afterEachHook("profile-experience-application");
    });

    it("adds three experience sections from the saved profile without submitting", async () => {
      await navigateAndWait(h.page, getFixtureUrl("experience-application"));
      await h.page.bringToFront();
      await expect
        .poll(
          () =>
            h.page.evaluate(() => {
              const draft = (window as any).experienceApplicationDraft;
              return draft
                ? {
                    sectionCount: draft.sectionCount,
                    submitted: draft.submitted,
                    eventCount: draft.events?.length ?? 0,
                  }
                : null;
            }),
          { timeout: 5_000 },
        )
        .toEqual({ sectionCount: 0, submitted: false, eventCount: 0 });

      const tabId = await getActiveTabId(h.ctx.serviceWorker);
      expect(tabId).toBeGreaterThan(0);

      const prompt =
        "Use the roles from my saved profile to complete my work history on this application. " +
        "Add the experience entries the page needs, keep them in profile order, and leave the application unsubmitted.";

      const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

      const outcome = await waitForOutcome(
        h.page,
        h.ctx.serviceWorker,
        async () =>
          (await h.page.evaluate((expected) => {
            const draft = (window as any).experienceApplicationDraft;
            const submitted = Boolean((window as any).experienceApplicationResult);
            if (!draft || submitted || draft.sectionCount !== 3) return null;
            const actual = draft.experiences ?? [];
            const complete =
              actual.length === expected.length &&
              expected.every((entry: any, index: number) => {
                const current = actual[index] ?? {};
                return (
                  current.company === entry.company &&
                  current.title === entry.title &&
                  current.startDate === entry.startDate &&
                  current.endDate === entry.endDate &&
                  current.summary === entry.summary
                );
              });
            return complete ? draft : null;
          }, expectedExperiences)) || null,
        360_000,
        workspaceId,
      );

      const { traceFiles } = await h.printTraceSummary(workspaceId);

      expect(outcome.ok, outcome.reason).toBe(true);
      expect(outcome.result).toMatchObject({
        sectionCount: 3,
        submitted: false,
        experiences: expectedExperiences,
      });
      expect(
        await h.page.evaluate(() =>
          Boolean((window as any).experienceApplicationResult),
        ),
      ).toBe(false);
      const eventSummary = await h.page.evaluate(() => {
        const events = (window as any).experienceApplicationDraft?.events ?? [];
        return {
          sectionAdds: events.filter((event: any) => event.type === "section_added")
            .length,
          submitted: events.some((event: any) => event.type === "submitted"),
        };
      });
      expect(eventSummary).toEqual({ sectionAdds: 3, submitted: false });
      expect(traceFilesContainText(traceFiles, "get_profile_fields")).toBe(true);
      expect(traceFilesContainText(traceFiles, "Atlas Labs")).toBe(true);

      await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
    }, 480_000);
  },
);
