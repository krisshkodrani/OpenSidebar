/**
 * E2E: Arena Suite — catalog-driven runner.
 *
 * Executes every task declared in `arena/tasks.ts` against its declared
 * validator. This is generic by construction: adding a task to the catalog
 * (with a `validator` that exists in `arena/validators.ts`) automatically
 * scores it here — no per-task test code.
 *
 * These runs use the real agent + a real LLM, so they are opt-in and excluded
 * from the default e2e sweep. Enable with the `arena` suite flag, and optionally
 * narrow the set:
 *
 *   E2E_SUITES=arena pnpm exec vitest run --config tests/e2e/vitest.e2e.config.ts tests/e2e/arena-suite.test.ts
 *   ARENA_TIER=easy,medium E2E_SUITES=arena <…>      # filter by tier
 *   ARENA_TASK=procurement.complete-first-two E2E_SUITES=arena <…>  # one task by id
 */

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
  updateUserSettings,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";
import { isE2ESuiteFlagEnabled } from "./helpers/e2e-config";
import { ARENA_TASKS, type ArenaTask } from "./arena/tasks";
import { getArenaValidator } from "./arena/validators";

const h = createE2EHarness({ maxTurns: 24, testLabel: "arena" });
const RUN_ARENA = isE2ESuiteFlagEnabled("arena");

/** Parse a comma/space separated env filter into a lowercased set, or null. */
function parseFilter(value: string | undefined): Set<string> | null {
  if (!value) return null;
  const entries = value
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return entries.length > 0 ? new Set(entries) : null;
}

const tierFilter = parseFilter(process.env.ARENA_TIER);
const taskFilter = parseFilter(process.env.ARENA_TASK);

function selectTasks(): readonly ArenaTask[] {
  return ARENA_TASKS.filter((task) => {
    if (tierFilter && !tierFilter.has(task.tier)) return false;
    if (taskFilter && !taskFilter.has(task.id.toLowerCase())) return false;
    return true;
  });
}

const selectedTasks = selectTasks();

describe.skipIf(!h.apiKey || !RUN_ARENA)("E2E: Arena Suite", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("arena"));
  afterAll(() => h.afterAllHook());

  for (const task of selectedTasks) {
    const validator = getArenaValidator(task.validator);

    // A task referencing a missing validator is a catalog wiring error — surface
    // it as a failing test rather than silently skipping coverage.
    it(`${task.tier} · ${task.id} — ${task.title}`, async () => {
      if (!validator) {
        throw new Error(
          `Arena task "${task.id}" references unknown validator "${task.validator}". ` +
            "Add it to ARENA_VALIDATORS in arena/validators.ts.",
        );
      }

      await updateUserSettings(h.ctx, {
        requireApprovals: false,
        allowNavigation: task.allowNavigation ?? false,
        maxTurns: task.maxTurns,
      });

      await navigateAndWait(h.page, getFixtureUrl(task.startRoute));
      await h.page.bringToFront();

      const tabId = await getActiveTabId(h.ctx.serviceWorker);
      expect(tabId, `No active tab for ${task.id}`).toBeGreaterThan(0);

      const workspaceId = await sendUserChat(h.ctx, task.prompt, tabId);

      const result = await validator({ task, harness: h, workspaceId });

      console.log(
        `[arena] ${task.id}: ${result.ok ? "PASS" : "FAIL"} — ${result.reason}` +
          (result.details.length ? `\n  ${result.details.join("\n  ")}` : ""),
      );

      await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);

      expect(
        result.ok,
        `${task.id} failed: ${result.reason}\n${result.details.join("\n")}\n` +
          `done: ${result.doneSummary.slice(0, 300)}`,
      ).toBe(true);
    }, task.timeoutMs + 60_000);
  }
});
