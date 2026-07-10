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
  updateUserSettings,
} from "./helpers/utils";
import { getArenaTask } from "./arena/tasks";
import { getArenaValidator } from "./arena/validators";

const h = createE2EHarness({
  maxTurns: 60,
  testLabel: "showcase-job-pipeline",
});

const SHOWCASE_TYPING_DELAY_MS = 10;
const ARENA_TASK_ID = "job-pipeline.stage-two-applications";

/**
 * Same objective and identity values as the arena task's prompt, formatted
 * as a table so the visible panel typing reads well on camera. The identity
 * values must stay byte-identical to the arena prompt — the shared validator
 * exact-matches name/email.
 */
function buildShowcasePrompt(): string {
  return [
    "I'm a senior frontend engineer with 5 years of experience specializing in React and TypeScript, with strong Node.js and GraphQL experience, looking for a fully remote position in the $120K–$160K range.",
    "",
    "Review the job listings, pick the two best matches for my profile, and start an application for each in its own tab. Fill in every field using my details:",
    "| Field | Value |",
    "|---|---|",
    "| Name | Jordan Reyes |",
    "| Email | jordan.reyes@example.com |",
    "| LinkedIn URL | https://www.linkedin.com/in/jordanreyes |",
    "| Phone | +1 555 010 0199 |",
    "| Current Location | Denver, CO |",
    "| EU Work Permit | No |",
    "| Salary Expectation | $120,000–$160,000 depending on role |",
    "| Earliest Start Date | 2026-08-03 |",
    "",
    "For the 'why do you care' question write 2–3 sentences grounded in that job's posting.",
    "Leave the Resume/CV upload empty — I'll attach that myself — and do NOT submit either application; leave both ready for me to review and send.",
  ].join("\n");
}

describe.skipIf(!h.apiKey)(
  "E2E Showcase: job pipeline — two staged applications",
  () => {
    let passed = false;

    beforeAll(() => h.beforeAllHook(), 180_000);
    beforeEach(async () => {
      passed = false;
      await h.beforeEachHook();
    });
    afterEach(() => h.afterEachHook("showcase-job-pipeline", passed));
    afterAll(() => h.afterAllHook());

    it("reads the board, stages two applications in separate tabs, and stops before submit", async () => {
      const task = getArenaTask(ARENA_TASK_ID);
      expect(task, `arena task ${ARENA_TASK_ID} must exist`).toBeDefined();
      const validator = getArenaValidator(task!.validator);
      expect(validator, `validator ${task!.validator} must exist`).toBeDefined();

      await updateUserSettings(h.ctx, {
        allowNavigation: true,
        maxTurns: task!.maxTurns,
      });

      await navigateAndWait(h.page, getFixtureUrl(task!.startRoute));
      await h.page.bringToFront();
      const tabId = await getActiveTabId(h.ctx.serviceWorker);
      expect(tabId).toBeGreaterThan(0);

      const workspaceId = await sendUserChat(
        h.ctx,
        buildShowcasePrompt(),
        tabId,
        null,
        {
          panelPromptEntry: "visible",
          typingDelayMs: SHOWCASE_TYPING_DELAY_MS,
        },
      );

      // The arena validator is the single source of truth for what "staged"
      // means (two qualifying tabs, all fields but the CV, nothing submitted),
      // so the filmed showcase can never drift from the scored benchmark.
      const result = await validator!({ task: task!, harness: h, workspaceId });
      await h.printTraceSummary(workspaceId);

      expect(
        result.ok,
        `${result.reason}\n${result.details.join("\n")}\ndone: ${result.doneSummary.slice(0, 300)}`,
      ).toBe(true);

      await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
      passed = true;
    }, 960_000);
  },
);
