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
import { getFixtureUrl } from "./helpers/fixture-server";
import {
  assertNoGhostSession,
  getActiveTabId,
  navigateAndWait,
  sendUserChat,
  waitForOutcome,
} from "./helpers/utils";
import { traceFilesContainText } from "./helpers/diagnostics";

const h = createE2EHarness({
  maxTurns: 24,
  testLabel: "showcase-ashby-application",
});

const SHOWCASE_TYPING_DELAY_MS = 10;

const expectedWhyLangfuse = [
  "I care about Langfuse because it solves one of the most important practical problems in AI product engineering. The work sits exactly at the boundary between developer experience and reliable AI systems.",
  "",
  "My recent work has been focused on browser agents, observability, and evaluation loops.",
].join("\n");

function buildShowcasePrompt(): string {
  return [
    "Fill out this Ashby application with my details below, exactly as written — but don't submit it, I want to review it first.",
    "| Field | Value |",
    "|---|---|",
    "| Name | John Doe |",
    "| Email | john.doe@example.com |",
    "| LinkedIn URL | https://www.linkedin.com/in/johndoe |",
    "| Phone | +1 555 010 0100 |",
    "| Current Location | New York, NY |",
    "| EU Work Permit | Yes |",
    "| Salary Expectation | USD 120,000-140,000 gross/year, negotiable depending on level, equity, and travel cadence |",
    "| Earliest Start Date | 2026-07-01 |",
    "",
    "## Why Do You Care About Langfuse?",
    "",
    expectedWhyLangfuse,
  ].join("\n");
}

describe.skipIf(!h.apiKey)("E2E Showcase: Ashby job application", () => {
  let passed = false;

  beforeAll(() => h.beforeAllHook(), 180_000);
  beforeEach(async () => {
    passed = false;
    await h.beforeEachHook();
  });
  afterEach(() => h.afterEachHook("showcase-ashby-application", passed));
  afterAll(() => h.afterAllHook());

  it("types a real panel prompt, fills the application, and stops before submit", async () => {
    await navigateAndWait(h.page, getFixtureUrl("ashby-job-application"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = buildShowcasePrompt();
    const workspaceId = await sendUserChat(h.ctx, prompt, tabId, null, {
      panelPromptEntry: "visible",
      typingDelayMs: SHOWCASE_TYPING_DELAY_MS,
    });

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
            draft.name === "John Doe" &&
            draft.email === "john.doe@example.com" &&
            draft.linkedIn === "https://www.linkedin.com/in/johndoe" &&
            draft.phone === "+1 555 010 0100" &&
            draft.currentLocation === "New York, NY" &&
            draft.euWorkPermit === "Yes" &&
            draft.salaryExpectation ===
              "USD 120,000-140,000 gross/year, negotiable depending on level, equity, and travel cadence" &&
            draft.earliestStartDate === "2026-07-01" &&
            draft.whyLangfuse === expected;

          return matches ? draft : null;
        }, expectedWhyLangfuse)) || null,
      420_000,
      workspaceId,
    );

    const { traceFiles } = await h.printTraceSummary(workspaceId);

    expect(outcome.ok, outcome.reason).toBe(true);
    expect(outcome.result).toMatchObject({
      name: "John Doe",
      email: "john.doe@example.com",
      linkedIn: "https://www.linkedin.com/in/johndoe",
      phone: "+1 555 010 0100",
      currentLocation: "New York, NY",
      euWorkPermit: "Yes",
      salaryExpectation:
        "USD 120,000-140,000 gross/year, negotiable depending on level, equity, and travel cadence",
      earliestStartDate: "2026-07-01",
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
    passed = true;
  }, 540_000);
});
