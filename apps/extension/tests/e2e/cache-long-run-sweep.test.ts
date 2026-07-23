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
 * it is ONE instruction the agent must decompose into eight searches, so the
 * turns accumulate inside a single session the way they do in a real long task.
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
 * maxTurns has to clear the compaction thresholds by a wide margin or the run
 * ends before the mechanism under test engages: rolling distillation needs 20+
 * messages, and threshold compaction fires at history lengths 20/40/70. At
 * roughly 2-3 messages per turn, 80 turns reaches all of them with headroom.
 */
const h = createE2EHarness({ maxTurns: 80, testLabel: "cache-long-run-sweep" });
const TURN_TIMEOUT = 180_000;
/** One long task rather than several short ones, so it needs a long ceiling. */
const SWEEP_TIMEOUT = 1_800_000;
const enableCacheLongE2E = isE2ESuiteFlagEnabled("cache-long");

/**
 * The eight departments the fixture generates. Naming them in the instruction
 * is what makes the run long: the agent has to search each one in turn.
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
      "decomposes one sweep instruction into a run long enough to compact",
      async () => {
        const workspaceId = `e2e-cache-long-${crypto.randomUUID()}`;

        await navigateAndWait(h.page, getFixtureUrl("data-table"));
        await h.page.bringToFront();
        const tabId = await getActiveTabId(h.ctx.serviceWorker);
        expect(tabId).toBeGreaterThan(0);

        // ONE message, so ONE agent session — the load-bearing detail.
        //
        // The first version of this test sent eight messages into a shared
        // workspace, assuming history would accumulate. It does not: each chat
        // message starts a NEW session with its own history and its own trace,
        // so eight messages produced eight SHORT runs and compaction never
        // fired. Run length is per session, so length has to come from a task
        // the agent decomposes internally.
        //
        // The recall clause at the end is what forces the agent to carry the
        // earlier findings forward rather than answering each department and
        // discarding it — and it fails if compaction destroys context the agent
        // still needed, which makes this a check on compaction QUALITY too. The
        // RFC's own risk note is that append-only growth can cost task success,
        // and offline metrics cannot detect that.
        await sendUserChat(
          h.ctx,
          `Using the employee table, work through these departments one at a time and search for each: ${DEPARTMENTS.join(", ")}. ` +
            `For each one, record how many employees it has. When you have done all ${DEPARTMENTS.length}, tell me the per-department counts and which department is largest.`,
          tabId,
          workspaceId,
        );

        const sweep = await waitForTaskCompletion(
          h.ctx,
          SWEEP_TIMEOUT,
          workspaceId,
        );
        expect(
          sweep.ok,
          `Sweep failed: ${sweep.reason}. If this times out rather than erroring, raise maxTurns — the task is deliberately long.`,
        ).toBe(true);

        await settleWorkspaceBetweenTurns(h.ctx.serviceWorker, workspaceId);
      },
      // One long agent task, plus headroom for setup and teardown.
      SWEEP_TIMEOUT + TURN_TIMEOUT,
    );
  },
);
