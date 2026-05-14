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
      "Read David's email and tell me the two proposed meeting times plus the main topics. Do not edit the reply box.",
      ["thursday", "friday", "budget", "hiring", "roadmap"],
    );

    const acceptedDraft = await actUntil<any>(
      ctx,
      "email turn 2",
      "Draft a short reply accepting Thursday at 2 PM. Mention the Q3 strategy meeting and do not click Send.",
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
      "Look at the current draft and tell me whether it accepts Thursday. Do not edit the draft.",
      ["thursday", "accept", "yes"],
    );
    expect(
      await h.page.evaluate(() => (window as any).emailResult?.message),
    ).toBe(acceptedText);

    const declinedDraft = await actUntil<any>(
      ctx,
      "email turn 4",
      "Change the draft to decline both proposed times because of conflicts. Suggest Monday at 11 AM instead. Keep it to 2-3 sentences and do not send.",
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
      "Add one line saying I will send the Q3 budget numbers before the meeting. Keep the Monday 11 AM suggestion and do not send.",
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
      "Confirm whether the reply is still only a draft and has not been sent. Do not click Send.",
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
      "Summarize the ticket problem, deadline pressure, and reported browser or OS. Do not change any fields.",
      ["csv", "timeout", "friday", "chrome", "windows"],
    );

    await actUntil<any>(
      ctx,
      "ticket turn 2",
      "Set the ticket status to In Progress and priority to Urgent. Do not add a comment yet.",
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
      "What are the ticket's current status and priority now? Do not edit anything.",
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
      "What organization ID and account plan are mentioned in the ticket description? Do not edit anything.",
      ["clt-9402", "enterprise"],
    );

    await actUntil<any>(
      ctx,
      "ticket turn 6",
      "Change the ticket status to Waiting on Customer, keep priority Urgent, and leave the internal note intact.",
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
      "Summarize the release status, remaining blockers, and who is waiting on whom. Do not send a chat message.",
      ["release", "changelog", "alice", "grace", "qa"],
    );

    await askQuestion(
      ctx,
      "chat turn 2",
      "Who should write the changelog and who will polish it for docs? Do not send anything.",
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
      "What did you just send? Answer only and do not send a second chat message.",
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
      "Read the Overview tab and tell me Total Users, Revenue, and Bounce Rate. Do not change settings.",
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
      "What notification email and timezone are currently saved? Do not change anything.",
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
      "Open the Reports tab and tell me the available report names. Do not download anything.",
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
      "What coupon code is advertised, and what is the price of Air Zoom Pegasus 41? Do not add anything to the cart.",
      ["save10", "149", "pegasus"],
    );

    await actUntil<any>(
      ctx,
      "shop turn 2",
      "Add Air Zoom Pegasus 41 to the cart with the default size and color. Do not check out yet.",
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
      "What is currently in the cart and what is the subtotal before discounts? Do not change the cart.",
      ["pegasus", "149"],
    );
    expect(
      await h.page.evaluate(() => (window as any).__shopState?.cart ?? []),
    ).toEqual(cartAfterAdd);

    await actUntil<any>(
      ctx,
      "shop turn 4",
      "Apply coupon SAVE10 and choose Express shipping. Do not place the order yet.",
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
      "What is the order ID and final total? Do not place another order.",
      ["ns-", "total", "casey.rivera@example.com"],
    );
    expect(
      await h.page.evaluate(() => (window as any).previousOrders?.length ?? 0),
    ).toBe(1);

    await h.printTraceSummary(ctx.workspaceId);
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, ctx.workspaceId);
  }, 900_000);
});
