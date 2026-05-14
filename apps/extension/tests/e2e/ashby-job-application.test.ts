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

const h = createE2EHarness({
  maxTurns: 24,
  testLabel: "ashby-job-application",
});

const expectedWhyLangfuse = [
  "I care about Langfuse because it solves one of the most important practical problems in AI product engineering. The work sits exactly at the boundary between developer experience and reliable AI systems.",
  "",
  "My recent work has been focused on browser agents, observability, and evaluation loops.",
].join("\n");

describe.skipIf(!h.apiKey)("E2E: Ashby Job Application Skill", () => {
  beforeAll(() => h.beforeAllHook(), 180_000);
  afterAll(() => h.afterAllHook());

  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("ashby-job-application"));

  it("fills Ashby application fields literally and stops before submit", async () => {
    await navigateAndWait(h.page, getFixtureUrl("ashby-job-application"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = [
      "Fill this Ashby application but do not submit using these data.",
      "| Field | Copy This |",
      "|---|---|",
      "| Name | Kris Shkodrani |",
      "| Email | kshkodrani@gmail.com |",
      "| LinkedIn URL | https://www.linkedin.com/in/krisshkodrani |",
      "| Phone | +43 664 99503226 |",
      "| Current Location | Linz, Austria |",
      "| EU Work Permit | Yes |",
      "| Salary Expectation | EUR 95,000-115,000 gross/year, negotiable depending on level, equity, and Berlin travel cadence |",
      "| Earliest Start Date | 2026-06-01 |",
      "",
      "## Why Do You Care About Langfuse?",
      "",
      expectedWhyLangfuse,
    ].join("\n");

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () =>
        (await h.page.evaluate((expected) => {
          const draft = (window as any).ashbyApplicationDraft;
          if (!draft || draft.submitted || (window as any).ashbyApplicationResult) {
            return null;
          }

          const matches =
            draft.name === "Kris Shkodrani" &&
            draft.email === "kshkodrani@gmail.com" &&
            draft.linkedIn === "https://www.linkedin.com/in/krisshkodrani" &&
            draft.phone === "+43 664 99503226" &&
            draft.currentLocation === "Linz, Austria" &&
            draft.euWorkPermit === "Yes" &&
            draft.salaryExpectation ===
              "EUR 95,000-115,000 gross/year, negotiable depending on level, equity, and Berlin travel cadence" &&
            draft.earliestStartDate === "2026-06-01" &&
            draft.whyLangfuse === expected;

          return matches ? draft : null;
        }, expectedWhyLangfuse)) || null,
      420_000,
      workspaceId,
    );

    const { traceFiles } = await h.printTraceSummary(workspaceId);

    expect(outcome.ok, outcome.reason).toBe(true);
    expect(outcome.result).toMatchObject({
      name: "Kris Shkodrani",
      email: "kshkodrani@gmail.com",
      linkedIn: "https://www.linkedin.com/in/krisshkodrani",
      phone: "+43 664 99503226",
      currentLocation: "Linz, Austria",
      euWorkPermit: "Yes",
      salaryExpectation:
        "EUR 95,000-115,000 gross/year, negotiable depending on level, equity, and Berlin travel cadence",
      earliestStartDate: "2026-06-01",
      whyLangfuse: expectedWhyLangfuse,
      submitted: false,
    });
    expect(await h.page.evaluate(() => (window as any).ashbyApplicationResult)).toBe(
      undefined,
    );
    expect(traceFilesContainText(traceFiles, "ashby-job-application-assistant")).toBe(
      true,
    );
    expect(traceFilesContainText(traceFiles, "Why Do You Care About Langfuse")).toBe(
      true,
    );

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 540_000);
});
