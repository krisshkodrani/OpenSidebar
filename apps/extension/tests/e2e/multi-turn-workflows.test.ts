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
  extractDoneSummary,
  findAllNewTraceFiles,
} from "./helpers/diagnostics";
import {
  assertNoGhostSession,
  getActiveTabId,
  navigateAndWait,
  sendUserChat,
  settleWorkspaceBetweenTurns,
  waitForOutcome,
  waitForTaskCompletion,
} from "./helpers/utils";

const h = createE2EHarness({
  maxTurns: 18,
  testLabel: "multi-turn-workflows",
});

const TURN_TIMEOUT = 210_000;

interface WorkflowContext {
  tabId: number;
  workspaceId: string;
}

function expectIncludesAny(text: string, terms: string[], label: string): void {
  const normalized = text.toLowerCase();
  expect(
    terms.some((term) => normalized.includes(term.toLowerCase())),
    `${label} should include one of: ${terms.join(", ")}\nActual: ${text.slice(0, 500)}`,
  ).toBe(true);
}

function expectIncludesAll(text: string, terms: string[], label: string): void {
  const normalized = text.toLowerCase();
  for (const term of terms) {
    expect(
      normalized.includes(term.toLowerCase()),
      `${label} should include "${term}"\nActual: ${text.slice(0, 500)}`,
    ).toBe(true);
  }
}

async function startWorkflow(
  route: string,
  label: string,
): Promise<WorkflowContext> {
  await navigateAndWait(h.page, getFixtureUrl(route));
  await h.page.bringToFront();
  const tabId = await getActiveTabId(h.ctx.serviceWorker);
  expect(tabId).toBeGreaterThan(0);
  return {
    tabId,
    workspaceId: `e2e-${label}-${crypto.randomUUID()}`,
  };
}

async function refreshTabId(ctx: WorkflowContext): Promise<void> {
  await h.page.bringToFront();
  ctx.tabId = await getActiveTabId(h.ctx.serviceWorker);
  expect(ctx.tabId).toBeGreaterThan(0);
}

async function askQuestion(
  ctx: WorkflowContext,
  label: string,
  prompt: string,
  expectedTerms: string[],
): Promise<string> {
  const tracesBeforeTurn = findAllNewTraceFiles(h.tracesBefore);

  await sendUserChat(h.ctx, prompt, ctx.tabId, ctx.workspaceId);
  const result = await waitForTaskCompletion(
    h.ctx,
    TURN_TIMEOUT,
    ctx.workspaceId,
  );
  expect(result.ok, `${label} failed: ${result.reason}`).toBe(true);

  const tracesAfterTurn = findAllNewTraceFiles(h.tracesBefore);
  const turnTraceFiles = tracesAfterTurn.filter(
    (filePath) => !tracesBeforeTurn.includes(filePath),
  );
  const answer = extractDoneSummary(
    turnTraceFiles.length > 0 ? turnTraceFiles : tracesAfterTurn,
  );

  expect(
    answer.trim().length,
    `${label} should produce a final answer`,
  ).toBeGreaterThan(0);
  expectIncludesAny(answer, expectedTerms, label);

  await settleWorkspaceBetweenTurns(h.ctx.serviceWorker, ctx.workspaceId);
  return answer;
}

async function actUntil<T>(
  ctx: WorkflowContext,
  label: string,
  prompt: string,
  check: () => Promise<T | null | undefined>,
): Promise<T> {
  await sendUserChat(h.ctx, prompt, ctx.tabId, ctx.workspaceId);
  const outcome = await waitForOutcome(
    h.page,
    h.ctx.serviceWorker,
    check,
    TURN_TIMEOUT,
    ctx.workspaceId,
  );
  expect(outcome.ok, `${label} failed: ${outcome.reason}`).toBe(true);
  expect(outcome.result, `${label} should return assertion state`).toBeTruthy();
  await settleWorkspaceBetweenTurns(h.ctx.serviceWorker, ctx.workspaceId);
  return outcome.result as T;
}

describe.skipIf(!h.apiKey)("E2E: Multi-turn user workflows", () => {
  beforeAll(() => h.beforeAllHook(), 120_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("multi-turn-workflows"));
  afterAll(() => h.afterAllHook());

  it("handles a 6-message email drafting conversation with question checkpoints", async () => {
    const ctx = await startWorkflow("email-compose", "email-draft");

    await askQuestion(
      ctx,
      "email turn 1",
      "What does David's email say? Give me the two proposed meeting times and the main topics.",
      ["thursday", "friday", "budget", "hiring", "roadmap"],
    );

    const acceptedDraft = await actUntil<any>(
      ctx,
      "email turn 2",
      "Draft a short reply accepting Thursday at 2 PM, and mention the Q3 strategy meeting. Don't send it yet.",
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).emailResult ?? null,
        );
        if (!result?.composed || result.sent) return null;
        const message = String(result.message ?? "").toLowerCase();
        return message.includes("thursday") &&
          (message.includes("2 pm") || message.includes("2pm"))
          ? result
          : null;
      },
    );

    const acceptedText = String(acceptedDraft.message);
    await askQuestion(
      ctx,
      "email turn 3",
      "Does the current draft accept Thursday?",
      ["thursday", "accept", "yes"],
    );
    expect(
      await h.page.evaluate(() => (window as any).emailResult?.message),
    ).toBe(acceptedText);

    const declinedDraft = await actUntil<any>(
      ctx,
      "email turn 4",
      "Actually, change it — decline both times, I have conflicts. Suggest Monday at 11 AM instead. Keep it to 2-3 sentences, and still don't send.",
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).emailResult ?? null,
        );
        if (!result?.composed || result.sent) return null;
        const message = String(result.message ?? "").toLowerCase();
        return message.includes("monday") &&
          (message.includes("11") || message.includes("eleven")) &&
          (message.includes("conflict") ||
            message.includes("decline") ||
            message.includes("cannot") ||
            message.includes("unable"))
          ? result
          : null;
      },
    );

    const finalDraft = await actUntil<any>(
      ctx,
      "email turn 5",
      "Also add a line to the draft that I'll send over the Q3 budget numbers before the meeting. Keep the Monday 11 AM part, and still don't send it.",
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).emailResult ?? null,
        );
        if (!result?.composed || result.sent) return null;
        const message = String(result.message ?? "").toLowerCase();
        return message.includes("monday") &&
          (message.includes("budget") ||
            message.includes("q3") ||
            message.includes("numbers"))
          ? result
          : null;
      },
    );
    expect(String(finalDraft.message)).not.toBe(String(declinedDraft.message));

    await askQuestion(
      ctx,
      "email turn 6",
      "Just checking — that reply is still a draft, right? It hasn't gone out?",
      ["draft", "not sent", "unsent", "has not been sent"],
    );
    expect(await h.page.evaluate(() => (window as any).emailResult?.sent)).toBe(
      false,
    );

    await h.printTraceSummary(ctx.workspaceId);
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, ctx.workspaceId);
  }, 900_000);

  it("handles a 6-message support ticket triage workflow", async () => {
    const ctx = await startWorkflow("support-ticket", "support-ticket");

    await askQuestion(
      ctx,
      "ticket turn 1",
      "Give me a quick rundown of this ticket — what's the problem, how urgent is it, and what browser or OS did they report?",
      ["csv", "timeout", "friday", "chrome", "windows"],
    );

    await actUntil<any>(
      ctx,
      "ticket turn 2",
      "Set the status to In Progress and bump the priority to Urgent. No comment yet — I'll give you one in a second.",
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).ticketResult ?? null,
        );
        return result?.currentStatus === "In Progress" &&
          result?.currentPriority === "Urgent"
          ? result
          : null;
      },
    );

    await askQuestion(
      ctx,
      "ticket turn 3",
      "What are the status and priority showing now?",
      ["in progress", "urgent"],
    );
    expect(
      await h.page.evaluate(() => {
        const result = (window as any).ticketResult;
        return {
          status: result?.currentStatus,
          priority: result?.currentPriority,
          comments: result?.commentsAdded,
        };
      }),
    ).toEqual({ status: "In Progress", priority: "Urgent", comments: 0 });

    await actUntil<any>(
      ctx,
      "ticket turn 4",
      "Add an internal note: Reproduced CSV export timeout for May sales report; investigating backend job queue before Friday deadline.",
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).ticketResult ?? null,
        );
        const comment = String(result?.lastComment ?? "").toLowerCase();
        return result?.commentsAdded === 1 &&
          result?.lastCommentInternal === true &&
          comment.includes("csv") &&
          comment.includes("backend")
          ? result
          : null;
      },
    );

    await askQuestion(
      ctx,
      "ticket turn 5",
      "What organization ID and account plan does the ticket description mention?",
      ["clt-9402", "enterprise"],
    );

    await actUntil<any>(
      ctx,
      "ticket turn 6",
      "Now set it to Waiting on Customer. Priority stays Urgent, and don't touch the note.",
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).ticketResult ?? null,
        );
        return result?.currentStatus === "Waiting on Customer" &&
          result?.currentPriority === "Urgent" &&
          result?.commentsAdded === 1
          ? result
          : null;
      },
    );

    await h.printTraceSummary(ctx.workspaceId);
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, ctx.workspaceId);
  }, 900_000);

  it("handles a 5-message team chat coordination workflow", async () => {
    const ctx = await startWorkflow("team-chat", "team-chat");

    await askQuestion(
      ctx,
      "chat turn 1",
      "Catch me up on this channel — where's the release at, what's still blocking, and who's waiting on whom?",
      ["release", "changelog", "alice", "grace", "qa"],
    );

    await askQuestion(
      ctx,
      "chat turn 2",
      "Who's supposed to write the changelog, and who polishes it for the docs?",
      ["release owner", "grace", "alice", "changelog"],
    );

    await actUntil<any>(
      ctx,
      "chat turn 3",
      "Send one short message in the channel asking Alice to confirm the release date and Grace to polish the changelog once the draft is ready. Mention that the release branch waits for the green light.",
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).chatResult ?? null,
        );
        const message = String(result?.message ?? "").toLowerCase();
        return result?.sent &&
          message.includes("alice") &&
          message.includes("grace") &&
          message.includes("changelog")
          ? result
          : null;
      },
    );

    const countAfterFirstMessage = await h.page.evaluate(
      () => (window as any).chatResult?.messageCount ?? 0,
    );
    await askQuestion(
      ctx,
      "chat turn 4",
      "What did you end up sending?",
      ["alice", "grace", "changelog"],
    );
    expect(
      await h.page.evaluate(
        () => (window as any).chatResult?.messageCount ?? 0,
      ),
    ).toBe(countAfterFirstMessage);

    await actUntil<any>(
      ctx,
      "chat turn 5",
      "Send a second brief follow-up saying QA found only 2 P3 issues and nothing blocking.",
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).chatResult ?? null,
        );
        const message = String(result?.message ?? "").toLowerCase();
        return result?.messageCount === countAfterFirstMessage + 1 &&
          message.includes("qa") &&
          message.includes("p3") &&
          (message.includes("nothing blocking") ||
            message.includes("not blocking"))
          ? result
          : null;
      },
    );

    await h.printTraceSummary(ctx.workspaceId);
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, ctx.workspaceId);
  }, 780_000);

  it("handles a 5-message dashboard read, settings edit, and report lookup workflow", async () => {
    const ctx = await startWorkflow("dashboard", "dashboard-settings");

    await askQuestion(
      ctx,
      "dashboard turn 1",
      "From the Overview tab, what are Total Users, Revenue, and Bounce Rate?",
      ["12,847", "48,392", "42.3", "bounce", "revenue"],
    );

    await actUntil<any>(
      ctx,
      "dashboard turn 2",
      "Open Settings, set Notification Email to ops@example.com, set Timezone to Pacific Time, and save.",
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).dashboardSettings ?? null,
        );
        return result?.email === "ops@example.com" &&
          (result?.timezone === "PST" || result?.timezone === "Pacific Time")
          ? result
          : null;
      },
    );

    await askQuestion(
      ctx,
      "dashboard turn 3",
      "What notification email and timezone are saved right now?",
      ["ops@example.com", "pst", "pacific"],
    );

    await actUntil<any>(
      ctx,
      "dashboard turn 4",
      "Change Notification Email to metrics@example.com, change Timezone to GMT, and save again.",
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).dashboardSettings ?? null,
        );
        return result?.email === "metrics@example.com" &&
          result?.timezone === "GMT"
          ? result
          : null;
      },
    );

    await askQuestion(
      ctx,
      "dashboard turn 5",
      "What reports are available on the Reports tab? Just the names — no need to download anything.",
      [
        "monthly performance",
        "user engagement",
        "conversion funnel",
        "traffic breakdown",
      ],
    );

    await h.printTraceSummary(ctx.workspaceId);
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, ctx.workspaceId);
  }, 780_000);

  it("handles a 6-message guided shopping workflow with state checks", async () => {
    const ctx = await startWorkflow("shop", "shopping-session");

    await askQuestion(
      ctx,
      "shop turn 1",
      "What coupon code is being advertised, and how much are the Air Zoom Pegasus 41?",
      ["save10", "149", "pegasus"],
    );

    await actUntil<any>(
      ctx,
      "shop turn 2",
      "Add the Air Zoom Pegasus 41 to the cart — default size and color are fine. Don't check out yet.",
      async () => {
        const state = await h.page.evaluate(
          () => (window as any).__shopState ?? null,
        );
        return state?.cart?.some((item: any) => item.id === "pegasus-41")
          ? state
          : null;
      },
    );

    const cartAfterAdd = await h.page.evaluate(
      () => (window as any).__shopState?.cart ?? [],
    );
    await askQuestion(
      ctx,
      "shop turn 3",
      "What's in the cart right now, and what's the subtotal before discounts?",
      ["pegasus", "149"],
    );
    expect(
      await h.page.evaluate(() => (window as any).__shopState?.cart ?? []),
    ).toEqual(cartAfterAdd);

    await actUntil<any>(
      ctx,
      "shop turn 4",
      "Apply the SAVE10 coupon and pick express shipping, but hold off on placing the order.",
      async () => {
        const state = await h.page.evaluate(
          () => (window as any).__shopState ?? null,
        );
        return state?.coupon === "SAVE10" && state?.shippingMethod === "express"
          ? state
          : null;
      },
    );

    const order = await actUntil<any>(
      ctx,
      "shop turn 5",
      "Checkout as Casey Rivera with email casey.rivera@example.com.",
      async () => {
        const lastOrder = await h.page.evaluate(
          () => (window as any).lastOrder ?? null,
        );
        return lastOrder?.email === "casey.rivera@example.com"
          ? lastOrder
          : null;
      },
    );
    expect(order.coupon).toBe("SAVE10");
    expect(order.shippingMethod).toBe("express");

    await askQuestion(
      ctx,
      "shop turn 6",
      "What's the order ID and the final total?",
      ["ns-", "total", "casey.rivera@example.com"],
    );
    expect(
      await h.page.evaluate(() => (window as any).previousOrders?.length ?? 0),
    ).toBe(1);

    await h.printTraceSummary(ctx.workspaceId);
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, ctx.workspaceId);
  }, 900_000);
});
