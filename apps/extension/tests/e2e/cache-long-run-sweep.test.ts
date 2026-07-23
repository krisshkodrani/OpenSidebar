/**
 * E2E: long-run prompt-cache sweep (RFC LP-21 / issue #103).
 *
 * Gated behind E2E_SUITE_FLAGS=cache-long. This exists to PRODUCE A POPULATION,
 * not to assert behaviour: the step-2 observation window produced no runs in the
 * `25-49` or `50+` bins, so `rolling_distill` never fired once and all five
 * prefix resets came from `threshold_compaction:light`.
 *
 * That matters because the whole of RFC LP-21 §6 is about compaction. A cache
 * A/B measured only on short runs cannot see the mechanism under test, and would
 * report a clean win for a change whose known risk (append-only history reaching
 * the context budget sooner, so `getPrompt`'s window starts sliding off the
 * front every turn) only appears on long conversations.
 *
 * ## Why a sweep rather than a turn-burner
 *
 * The task has to be a realistic workload or the cache numbers do not generalise.
 * A breadth-first extraction sweep is exactly that — collecting a field across
 * many similar records is ordinary agent work — and it produces length honestly:
 * each department is a few turns, and the turns accumulate because they all share
 * one workspace, so history grows the way it does in a real long session.
 *
 * `data-table` is used because its 50 employees across 8 departments are
 * generated deterministically, so the same task yields a comparable population on
 * both arms of an A/B. Nothing is submitted and no state is mutated: the sweep is
 * read-only, so it can be re-run as often as an A/B needs.
 *
 * ## What "passing" means here
 *
 * Reaching the end with the agent still coherent. The cache verdict comes from
 * the traces afterwards, NOT from assertions in this file:
 *
 *   pnpm run cache:report -- --since <run start> \
 *     --baseline .artifacts/cache/baseline-2026-07-23.json
 *
 * Asserting a cache rate here would be wrong — it would bind a test to provider
 * behaviour that is policy, not contract.
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
import { getFixtureUrl } from "./helpers/fixture-server";
import {
  getActiveTabId,
  navigateAndWait,
  sendUserChat,
  settleWorkspaceBetweenTurns,
  waitForTaskCompletion,
} from "./helpers/utils";
import { isE2ESuiteFlagEnabled } from "./helpers/e2e-config";

/**
 * Generous per-step budget: the point is to accumulate turns across the sweep,
 * not to pressure any single step into giving up early. Budget pressure changes
 * agent behaviour, which would change the cache population being measured.
 */
const h = createE2EHarness({ maxTurns: 12, testLabel: "cache-long-run-sweep" });
const TURN_TIMEOUT = 180_000;
const enableCacheLongE2E = isE2ESuiteFlagEnabled("cache-long");

/**
 * The eight departments the fixture generates. Each is one step of the sweep;
 * together they carry the run past the point where compaction fires repeatedly.
 */
const DEPARTMENTS = [
  "Engineering",
  "Sales",
  "Marketing",
  "HR",
  "Finance",
  "Operations",
  "Legal",
  "Support",
] as const;

describe.skipIf(!h.apiKey || !enableCacheLongE2E)(
  "E2E: long-run prompt-cache sweep",
  () => {
    beforeAll(() => h.beforeAllHook(), 60_000);
    beforeEach(() => h.beforeEachHook());
    afterEach(() => h.afterEachHook("cache-long-run-sweep"));
    afterAll(() => h.afterAllHook());

    it(
      "sweeps every department in one workspace so history grows past compaction",
      async () => {
        const workspaceId = `e2e-cache-long-${crypto.randomUUID()}`;

        await navigateAndWait(h.page, getFixtureUrl("data-table"));
        await h.page.bringToFront();
        const tabId = await getActiveTabId(h.ctx.serviceWorker);
        expect(tabId).toBeGreaterThan(0);

        // One workspace for the whole sweep. This is the load-bearing detail:
        // separate workspaces would reset history each time and never reach the
        // lengths where rolling distillation and threshold compaction engage.
        for (const [index, department] of DEPARTMENTS.entries()) {
          await sendUserChat(
            h.ctx,
            `Search the employee table for ${department} and tell me how many ${department} employees there are, plus their names.`,
            tabId,
            workspaceId,
          );

          const step = await waitForTaskCompletion(
            h.ctx,
            TURN_TIMEOUT,
            workspaceId,
          );
          // A mid-sweep failure still leaves a usable (shorter) population, so
          // the message names the step rather than just failing the run.
          expect(
            step.ok,
            `Sweep step ${index + 1}/${DEPARTMENTS.length} (${department}) failed: ${step.reason}`,
          ).toBe(true);

          await settleWorkspaceBetweenTurns(h.ctx.serviceWorker, workspaceId);
        }

        // A recall step at the end: it depends on the earlier turns, so it fails
        // if compaction has quietly destroyed the history it needed. That makes
        // this a check on compaction QUALITY, not just on cache mechanics — the
        // RFC's own risk note is that append-only growth can cost task success.
        await sendUserChat(
          h.ctx,
          "Across everything you just looked at, which department had the most employees?",
          tabId,
          workspaceId,
        );
        const recall = await waitForTaskCompletion(
          h.ctx,
          TURN_TIMEOUT,
          workspaceId,
        );
        expect(
          recall.ok,
          `Recall after the sweep failed: ${recall.reason}. If this fails while the sweep steps passed, compaction dropped context the agent still needed.`,
        ).toBe(true);
      },
      // Nine sequential agent steps, each up to the turn timeout.
      TURN_TIMEOUT * DEPARTMENTS.length + TURN_TIMEOUT * 2,
    );
  },
);
