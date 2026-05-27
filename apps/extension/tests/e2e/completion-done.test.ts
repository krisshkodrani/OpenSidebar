import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import type { CDPSession, Page } from "puppeteer";
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
  waitForTaskCompletion,
  waitForWorkspaceIdle,
} from "./helpers/utils";
import {
  installLocalMockProviderInterceptor,
  localMockProviderScenarios,
  type LocalMockProviderScenarioName,
} from "./helpers/local-mock-provider";
import {
  readRunCompletionForTraceFiles,
  readTrace,
} from "./helpers/diagnostics";

const enabled = process.env.E2E_LOCAL_MOCK_PROVIDER === "1";

if (enabled) {
  process.env.E2E_PROVIDER = "fireworks";
  process.env.FIREWORKS_API_KEY = process.env.FIREWORKS_API_KEY || "local-mock";
}

type TraceEvent = {
  type?: string;
  data?: Record<string, unknown>;
};

type TraceSessionRecord = {
  sessionId?: string;
  partialHandoff?: {
    status?: string;
    evidence?: unknown[];
    remaining?: unknown[];
    suggestedContinuationPrompt?: string;
  };
  events?: TraceEvent[];
};

interface DoneScenarioResult<T> {
  outcome: {
    ok: boolean;
    reason: string;
    result: T | null;
    events: unknown[];
  };
  traceFiles: string[];
  turns: ReturnType<typeof readTrace>;
  traceSessions: TraceSessionRecord[];
  traceEvents: TraceEvent[];
  traceText: string;
}

function readTurnEvents(traceFiles: string[]): TraceEvent[] {
  return traceFiles.flatMap((traceFile) =>
    readFileSync(traceFile, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const entry = JSON.parse(line) as {
            events?: TraceEvent[];
          };
          return Array.isArray(entry.events) ? entry.events : [];
        } catch {
          return [];
        }
      }),
  );
}

function readTraceText(traceFiles: string[]): string {
  return traceFiles
    .map((traceFile) => readFileSync(traceFile, "utf-8"))
    .join("\n");
}

function traceSessionIds(traceFiles: string[]): Set<string> {
  return new Set(
    traceFiles
      .map((traceFile) =>
        traceFile
          .split(/[\\/]/)
          .pop()
          ?.replace(/\.jsonl$/i, ""),
      )
      .filter((value): value is string => Boolean(value)),
  );
}

function readTraceSessionsForTraceFiles(
  traceFiles: string[],
): TraceSessionRecord[] {
  const sessionIds = traceSessionIds(traceFiles);
  try {
    return readFileSync("traces/index.jsonl", "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const session = JSON.parse(line) as TraceSessionRecord;
          return session.sessionId && sessionIds.has(session.sessionId)
            ? [session]
            : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function latestTaskCompletionEvent(events: unknown[]): any | null {
  return (
    [...events]
      .reverse()
      .find((event: any) => event?.type === "TASK_COMPLETION") ?? null
  );
}

function toolCallNames(turns: ReturnType<typeof readTrace>): string[] {
  return turns.flatMap((turn) =>
    turn.toolCalls.map((toolCall) => toolCall.name),
  );
}

function countToolCalls(
  turns: ReturnType<typeof readTrace>,
  toolName: string,
): number {
  return toolCallNames(turns).filter((name) => name === toolName).length;
}

function hasTraceEvent(
  result: DoneScenarioResult<unknown>,
  type: string,
  predicate: (event: TraceEvent) => boolean = () => true,
): boolean {
  return result.traceEvents.some(
    (event) => event.type === type && predicate(event),
  );
}

function expectAcceptedDone(result: DoneScenarioResult<unknown>): void {
  expect(toolCallNames(result.turns)).toContain("done");
  expect(
    hasTraceEvent(result, "completion_envelope_created"),
    "done() should create a trusted completion envelope",
  ).toBe(true);
  expect(
    hasTraceEvent(
      result,
      "completion_state_transition",
      (event) => event.data?.to === "completed",
    ),
    "accepted done should transition the completion state to completed",
  ).toBe(true);

  const runCompletion = readRunCompletionForTraceFiles(result.traceFiles);
  if (runCompletion) {
    expect(runCompletion.status).toBe("completed");
  }
}

function expectNoTraceMatch(
  result: DoneScenarioResult<unknown>,
  pattern: RegExp,
): void {
  expect(result.traceText).not.toMatch(pattern);
}

async function runLocalMockDoneScenario<T>(
  scenarioName: LocalMockProviderScenarioName,
  pageCheck: ((page: Page) => Promise<T | null | undefined>) | null,
  assertResult: (result: DoneScenarioResult<T>) => Promise<void> | void,
): Promise<void> {
  const scenario = localMockProviderScenarios[scenarioName];
  const h = createE2EHarness({
    maxTurns: scenario.maxTurns,
    testLabel: scenario.label,
    videoStart: "manual",
  });
  let passed = false;
  let cdp: CDPSession | null = null;

  try {
    await h.beforeAllHook();
    cdp = await h.ctx.serviceWorkerTarget.createCDPSession();
    await installLocalMockProviderInterceptor(cdp, scenarioName);
    await h.beforeEachHook();
    await navigateAndWait(h.page, getFixtureUrl(scenario.fixture));
    await h.page.bringToFront();

    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    const workspaceId = `e2e-${randomUUID()}`;
    await ensureE2EPanel(h.ctx, tabId, workspaceId);
    await h.startVideoRecording();
    await sendUserChat(h.ctx, scenario.prompt, tabId, workspaceId);

    const outcome = pageCheck
      ? await waitForOutcome(
          h.page,
          h.ctx.serviceWorker,
          () => pageCheck(h.page),
          scenario.timeoutMs,
          workspaceId,
        )
      : await waitForTaskCompletion(
          h.ctx,
          scenario.timeoutMs,
          workspaceId,
        ).then((taskOutcome) => ({
          ...taskOutcome,
          result: null as T | null,
        }));

    if (outcome.ok) {
      await waitForWorkspaceIdle(h.ctx.serviceWorker, workspaceId, 10_000);
      await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
    }

    const { traceFiles } = await h.printTraceSummary(workspaceId);
    const turns = traceFiles.flatMap((traceFile) => readTrace(traceFile));
    const traceSessions = readTraceSessionsForTraceFiles(traceFiles);
    const result: DoneScenarioResult<T> = {
      outcome,
      traceFiles,
      turns,
      traceSessions,
      traceEvents: [
        ...readTurnEvents(traceFiles),
        ...traceSessions.flatMap((session) =>
          Array.isArray(session.events) ? session.events : [],
        ),
      ],
      traceText: readTraceText(traceFiles),
    };

    if (!outcome.ok) {
      console.log(JSON.stringify({ outcome }, null, 2));
    }

    await assertResult(result);
    passed = true;
  } finally {
    await h.afterEachHook(scenario.label, passed);
    if (cdp) await cdp.detach().catch(() => {});
    await h.afterAllHook().catch(() => {});
  }
}

async function readMessagingDraft(page: Page): Promise<{
  composed: boolean;
  sent: boolean;
  message: string;
  textareaValue: string;
} | null> {
  return page.evaluate(() => {
    const result = (window as any).messagingResult;
    const textarea = document.getElementById(
      "reply-editor",
    ) as HTMLTextAreaElement | null;
    const message =
      typeof result?.message === "string"
        ? result.message
        : (textarea?.value ?? "");
    if (!message.includes("aktuell auf der Suche nach einer Stelle")) {
      return null;
    }
    return {
      composed: Boolean(result?.composed || textarea?.value),
      sent: Boolean(result?.sent),
      message,
      textareaValue: textarea?.value ?? "",
    };
  });
}

async function readPartnerRegistrationResult(page: Page): Promise<{
  submitted: boolean;
  fullName: string;
  email: string;
  company: string;
  inviteCode: string;
  attemptCount: number;
} | null> {
  return page.evaluate(() => {
    const result = (window as any).partnerRegistrationResult;
    if (!result?.submitted) return null;
    return {
      submitted: Boolean(result.submitted),
      fullName: String(result.fullName ?? ""),
      email: String(result.email ?? ""),
      company: String(result.company ?? ""),
      inviteCode: String(result.inviteCode ?? ""),
      attemptCount: Number(result.attemptCount ?? 0),
    };
  });
}

describe.skipIf(!enabled)("E2E: completion done hardening", () => {
  test("max-turn information gathering emits a partial handoff for continuation", async () => {
    await runLocalMockDoneScenario(
      "partial-handoff-max-turns",
      null,
      (result) => {
        expect(result.outcome.ok).toBe(false);
        expect(result.outcome.reason).toBe("task_partial");

        const completion = latestTaskCompletionEvent(result.outcome.events);
        const payload = completion?.payload ?? completion;
        expect(payload?.status ?? completion?.status).toBe("partial");
        expect(payload?.partialHandoff).toMatchObject({
          status: "partial_handoff",
          reason: "max_turns",
        });
        expect(payload?.summary).toContain(
          "Status: Partial - turn budget exhausted",
        );
        expect(payload?.summary).toContain("This is incomplete");
        expect(payload?.summary).toContain("Suggested continuation:");
        expect(payload?.partialHandoff?.evidence?.length ?? 0).toBeGreaterThan(
          0,
        );
        expect(
          payload?.partialHandoff?.suggestedContinuationPrompt,
        ).toContain("Continue from the previous partial handoff");

        expect(toolCallNames(result.turns)).toContain("read_page");
        expect(toolCallNames(result.turns)).not.toContain("done");
        expect(
          hasTraceEvent(result, "partial_handoff_created"),
          "max-turn handoff should be visible as a trace event",
        ).toBe(true);
        expect(
          result.traceSessions.some(
            (session) => session.partialHandoff?.status === "partial_handoff",
          ),
          "trace session should expose partialHandoff without scanning turns",
        ).toBe(true);
      },
    );
  }, 240_000);

  test("draft-only composer completion accepts live read_element value and leaves the draft unsent", async () => {
    await runLocalMockDoneScenario(
      "done-draft-read-element",
      readMessagingDraft,
      (result) => {
        expect(result.outcome.ok, result.outcome.reason).toBe(true);
        expect(result.outcome.result).toMatchObject({
          composed: true,
          sent: false,
        });
        expect(result.outcome.result?.message).toContain(
          "nicht frueher geantwortet",
        );
        expect(result.outcome.result?.textareaValue).toContain(
          "aktuell auf der Suche nach einer Stelle",
        );
        expect(toolCallNames(result.turns)).toEqual(
          expect.arrayContaining(["type_text", "read_element", "done"]),
        );
        expectAcceptedDone(result);
        expectNoTraceMatch(
          result,
          /No active unsent draft evidence is visible/i,
        );
        expectNoTraceMatch(
          result,
          /summary does not end as a complete sentence/i,
        );
        expectNoTraceMatch(result, /\bClicked element\b[\s\S]*Senden/i);
      },
    );
  }, 240_000);

  test("premature draft-only done is rejected, recovers with composer evidence, and then completes", async () => {
    await runLocalMockDoneScenario(
      "done-draft-premature-recovery",
      readMessagingDraft,
      (result) => {
        expect(result.outcome.ok, result.outcome.reason).toBe(true);
        expect(result.outcome.result).toMatchObject({
          composed: true,
          sent: false,
        });
        expect(countToolCalls(result.turns, "done")).toBeGreaterThanOrEqual(2);
        expect(toolCallNames(result.turns)).toEqual(
          expect.arrayContaining(["type_text", "read_element", "done"]),
        );
        expect(result.traceText).toMatch(
          /No active unsent draft evidence is visible/i,
        );
        expect(
          hasTraceEvent(result, "completion_recovery_hint"),
          "rejected done should produce a recovery hint",
        ).toBe(true);
        expectAcceptedDone(result);
        expectNoTraceMatch(
          result,
          /summary does not end as a complete sentence/i,
        );
      },
    );
  }, 240_000);

  test("form submit task rejects done before confirmation and completes only after submit confirmation", async () => {
    await runLocalMockDoneScenario(
      "done-form-submit-gating",
      readPartnerRegistrationResult,
      (result) => {
        expect(result.outcome.ok, result.outcome.reason).toBe(true);
        expect(result.outcome.result).toMatchObject({
          submitted: true,
          fullName: "Sam Rivera",
          email: "sam.rivera@example.com",
          company: "Northstar Analytics",
          inviteCode: "PN-4821",
        });
        expect(countToolCalls(result.turns, "done")).toBeGreaterThanOrEqual(2);
        expect(toolCallNames(result.turns)).toContain("click_element");
        expect(
          hasTraceEvent(result, "completion_recovery_hint"),
          "pre-submit done should be rejected with a recovery hint",
        ).toBe(true);
        expect(result.traceText).toMatch(
          /submit\/confirmation evidence is missing|confirmation evidence is missing|Requested action has no matching visible confirmation/i,
        );
        expectAcceptedDone(result);
      },
    );
  }, 240_000);

  test("incomplete long summarize done is rejected and a complete summary then finishes", async () => {
    await runLocalMockDoneScenario(
      "done-summary-incomplete-recovery",
      null,
      (result) => {
        expect(result.outcome.ok, result.outcome.reason).toBe(true);
        expect(toolCallNames(result.turns)).toContain("read_page");
        expect(countToolCalls(result.turns, "done")).toBeGreaterThanOrEqual(2);
        expect(
          hasTraceEvent(result, "done_rejected_incomplete_summary"),
          "long incomplete summarize done should be rejected",
        ).toBe(true);
        expect(result.traceText).toMatch(
          /summary ends with an unfinished phrase|summary does not end as a complete sentence|summary ends with an open separator/i,
        );
        expect(result.traceText).toMatch(/positional encoding/i);
        expectAcceptedDone(result);
      },
    );
  }, 240_000);

  test("select-only quiz completion survives stale planner target and recovery nudges done", async () => {
    await runLocalMockDoneScenario(
      "quiz-derailment",
      async (page) => page.evaluate(() => (window as any).quizResult ?? null),
      (result) => {
        expect(result.outcome.ok, result.outcome.reason).toBe(true);
        expect(result.outcome.result).toMatchObject({
          completed: true,
          questionNumber: 32,
          selected: expect.arrayContaining([
            "Domain Adaptation Fine-Tuning",
            "Continued Pre-Training",
          ]),
        });
        expect(
          (result.outcome.result as { selected?: unknown[] }).selected,
        ).toHaveLength(2);
        expect(toolCallNames(result.turns)).toContain("done");
        expect(hasTraceEvent(result, "completion_contract_repaired")).toBe(
          true,
        );
        expect(hasTraceEvent(result, "completion_recovery_hint")).toBe(true);
        expectAcceptedDone(result);
      },
    );
  }, 240_000);
});
