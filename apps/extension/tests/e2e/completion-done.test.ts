import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { describe, expect, test } from "vitest";
import { createE2EHarness } from "./helpers/harness";
import { getFixtureUrl } from "./helpers/fixture-server";
import { ensureE2EPanel } from "./helpers/browser";
import {
  assertNoGhostSession,
  getActiveTabId,
  navigateAndWait,
  sendUserChat,
  waitForOutcome,
} from "./helpers/utils";
import {
  installLocalMockProviderInterceptor,
  localMockProviderScenarios,
} from "./helpers/local-mock-provider";
import { readTrace } from "./helpers/diagnostics";

const enabled = process.env.E2E_LOCAL_MOCK_PROVIDER === "1";

if (enabled) {
  process.env.E2E_PROVIDER = "fireworks";
  process.env.FIREWORKS_API_KEY =
    process.env.FIREWORKS_API_KEY || "local-mock";
}

function readTurnEvents(traceFiles: string[]) {
  return traceFiles.flatMap((traceFile) =>
    readFileSync(traceFile, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const entry = JSON.parse(line) as {
            events?: Array<{ type?: string; data?: Record<string, unknown> }>;
          };
          return Array.isArray(entry.events) ? entry.events : [];
        } catch {
          return [];
        }
      }),
  );
}

describe.skipIf(!enabled)("E2E: completion done regression", () => {
  test(
    "select-only quiz completion survives stale planner target and recovery nudges done",
    async () => {
      const scenario = localMockProviderScenarios["quiz-derailment"];
      const h = createE2EHarness({
        maxTurns: scenario.maxTurns,
        testLabel: scenario.label,
        videoStart: "manual",
      });
      let passed = false;
      let cdp: { detach: () => Promise<void> } | null = null;

      try {
        await h.beforeAllHook();
        cdp = await h.ctx.serviceWorkerTarget.createCDPSession();
        await installLocalMockProviderInterceptor(cdp, "quiz-derailment");
        await h.beforeEachHook();
        await navigateAndWait(h.page, getFixtureUrl(scenario.fixture));
        await h.page.bringToFront();

        const tabId = await getActiveTabId(h.ctx.serviceWorker);
        const workspaceId = `e2e-${randomUUID()}`;
        await ensureE2EPanel(h.ctx, tabId, workspaceId);
        await h.startVideoRecording();
        await sendUserChat(h.ctx, scenario.prompt, tabId, workspaceId);

        const outcome = await waitForOutcome(
          h.page,
          h.ctx.serviceWorker,
          () => h.page.evaluate(() => (window as any).quizResult ?? null),
          scenario.timeoutMs,
          workspaceId,
        );

        if (outcome.ok) {
          await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
        }

        const { traceFiles } = await h.printTraceSummary(workspaceId);
        const turns = traceFiles.flatMap((traceFile) => readTrace(traceFile));
        const events = readTurnEvents(traceFiles);
        const toolCallNames = turns.flatMap((turn) =>
          turn.toolCalls.map((toolCall) => toolCall.name),
        );

        if (!outcome.ok) {
          console.log(JSON.stringify({ outcome }, null, 2));
        }

        expect(outcome.ok, outcome.reason).toBe(true);
        expect(outcome.result).toMatchObject({
          completed: true,
          questionNumber: 32,
          selected: expect.arrayContaining([
            "Domain Adaptation Fine-Tuning",
            "Continued Pre-Training",
          ]),
        });
        expect((outcome.result as { selected?: unknown[] }).selected).toHaveLength(
          2,
        );
        expect(toolCallNames).toContain("done");
        expect(
          events.some((event) => event.type === "completion_contract_repaired"),
        ).toBe(true);
        expect(
          events.some((event) => event.type === "completion_recovery_hint"),
        ).toBe(true);
        expect(
          events.some((event) => event.type === "completion_envelope_created"),
        ).toBe(true);

        passed = true;
      } finally {
        await h.afterEachHook(scenario.label, passed);
        if (cdp) await cdp.detach().catch(() => {});
        await h.afterAllHook().catch(() => {});
      }
    },
    240_000,
  );
});
