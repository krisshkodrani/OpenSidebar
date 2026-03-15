import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import {
  launchWithExtension,
  closeExtension,
  openHelperPage,
  type ExtensionContext,
} from "./helpers/browser";
import {
  getActiveTabId,
  getMonitoredEvents,
  navigateAndWait,
  resetExtensionState,
  sendUserChat,
  setupEventMonitor,
} from "./helpers/utils";
import {
  startFixtureServer,
  stopFixtureServer,
  getFixtureUrl,
} from "./helpers/fixture-server";
import {
  attachSwConsole,
  findNewTraceFile,
  formatTraceSummary,
  readTrace,
  snapshotTraceFiles,
  startLogServer,
  stopLogServer,
} from "./helpers/diagnostics";
import type { Page } from "puppeteer";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

function loadApiKey(): string | undefined {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const envPath = resolve(__dirname, "../../.env");
  if (!existsSync(envPath)) return undefined;
  const content = readFileSync(envPath, "utf-8");
  const match = content.match(/OPENROUTER_API_KEY=(.+)/);
  return match?.[1]?.trim() || undefined;
}

async function waitForTaskCompletion(
  ctx: ExtensionContext,
  timeoutMs: number,
  workspaceId: string,
): Promise<{ ok: boolean; reason: string; events: any[] }> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const events = (await getMonitoredEvents(ctx.serviceWorker, 80)).filter(
      (event: any) =>
        event.workspaceId == null || event.workspaceId === workspaceId,
    );
    const completion = [...events]
      .reverse()
      .find((event: any) => event.type === "TASK_COMPLETION");
    if (completion?.status === "completed" || completion?.status === "partial") {
      return { ok: true, reason: String(completion.status), events };
    }

    const taskCompleteStep = [...events]
      .reverse()
      .find(
        (event: any) =>
          event.type === "AGENT_STEP" &&
          String(event.stepLabel || "").includes("Task complete"),
      );
    if (taskCompleteStep) {
      return { ok: true, reason: "task_complete_step", events };
    }

    const lastStatus = [...events]
      .reverse()
      .find((event: any) => event.type === "AGENT_STATUS");
    if (lastStatus?.status === "IDLE") {
      return { ok: true, reason: "idle", events };
    }
    if (lastStatus?.status === "ERROR") {
      return {
        ok: false,
        reason: `agent_error:${lastStatus.detail || "unknown"}`,
        events,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  return {
    ok: false,
    reason: "timeout",
    events: await getMonitoredEvents(ctx.serviceWorker, 80),
  };
}

const API_KEY = loadApiKey();

describe.skipIf(!API_KEY)("E2E: Summarize", () => {
  let ctx: ExtensionContext;
  let page: Page;
  let detachConsole: (() => void) | null = null;
  let tracesBefore: Set<string>;

  beforeAll(async () => {
    await startLogServer();
    await startFixtureServer();
    ctx = await launchWithExtension();
    detachConsole = await attachSwConsole(ctx.browser);

    const pages = await ctx.browser.pages();
    page = pages.find((candidate) => !candidate.url().startsWith("chrome-extension://"))
      || (await ctx.browser.newPage());

    const helper = await openHelperPage(ctx);
    await helper.evaluate(async (key: string) => {
      await chrome.storage.local.set({ openRouterApiKey_local: key });
      await chrome.storage.sync.set({
        userSettings: {
          requireApprovals: false,
          allowNavigation: false,
          requirePlanConfirmation: false,
          showElementTags: false,
          maxTurns: 6,
        },
      });
    }, API_KEY!);
    await helper.close();

    await setupEventMonitor(ctx.serviceWorker);
  }, 60_000);

  beforeEach(async () => {
    await resetExtensionState(ctx);
    tracesBefore = snapshotTraceFiles();
    if (page.isClosed()) {
      page = await ctx.browser.newPage();
    }
  });

  afterEach(async () => {
    await resetExtensionState(ctx);
  });

  afterAll(async () => {
    if (detachConsole) detachConsole();
    if (ctx) await closeExtension(ctx);
    await stopFixtureServer();
    await stopLogServer();
  });

  it(
    "summarizes a static text page in at most two turns using read-only tools",
    async () => {
      await navigateAndWait(page, getFixtureUrl("summarize-page.html"));
      await page.bringToFront();
      const tabId = await getActiveTabId(ctx.serviceWorker);
      expect(tabId).toBeGreaterThan(0);

      const prompt = [
        "Summarize this page in 2-3 sentences.",
        "Mention the product purpose, one capability, and one concrete fact.",
      ].join(" ");

      const workspaceId = await sendUserChat(ctx, prompt, tabId);

      const outcome = await waitForTaskCompletion(ctx, 90_000, workspaceId);
      expect(outcome.ok, JSON.stringify(outcome.events.slice(-10), null, 2)).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const traceFile = findNewTraceFile(tracesBefore);
      expect(traceFile).toBeTruthy();

      const turns = readTrace(traceFile!);
      console.log(formatTraceSummary(turns));
      console.log(`[e2e:summarize] Trace: ${traceFile}`);

      expect(turns.length).toBeLessThanOrEqual(2);

      const toolCalls = turns.flatMap((turn) => turn.toolCalls.map((tool) => tool.name));
      expect(toolCalls.at(-1)).toBe("done");
      expect(toolCalls.every((name) => ["done", "read_page"].includes(name))).toBe(true);

      const forbiddenActionTools = toolCalls.filter((name) =>
        ["click_element", "type_text", "navigate", "scroll_page"].includes(name),
      );
      expect(forbiddenActionTools).toEqual([]);
    },
    120_000,
  );
});
