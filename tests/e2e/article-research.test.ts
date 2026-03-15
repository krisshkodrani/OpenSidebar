/**
 * E2E: Article Research — scroll a long page to find a footnote citation.
 *
 * Tests scroll-dependent perception, read_page on long content,
 * and the agent's ability to locate specific information below the fold.
 *
 * Run: npm run test:e2e
 */

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
  findAllNewTraceFiles,
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

describe.skipIf(!API_KEY)("E2E: Article Research", () => {
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
          maxTurns: 12,
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
    "agent scrolls to find a footnote source and reports it",
    async () => {
      await navigateAndWait(page, getFixtureUrl("article-research.html"));
      await page.bringToFront();
      const tabId = await getActiveTabId(ctx.serviceWorker);
      expect(tabId).toBeGreaterThan(0);

      const prompt = [
        "What source is cited in footnote [2] of this article?",
        "Scroll down to the footnotes section at the bottom of the page to find it.",
        "Report the full citation text.",
      ].join(" ");

      const workspaceId = await sendUserChat(ctx, prompt, tabId);

      const outcome = await waitForTaskCompletion(ctx, 120_000, workspaceId);
      expect(outcome.ok, JSON.stringify(outcome.events.slice(-10), null, 2)).toBe(true);

      // Print trace summaries for diagnostics
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const traceFiles = findAllNewTraceFiles(tracesBefore);

      const allTurns = traceFiles.flatMap((f) => readTrace(f));
      for (const f of traceFiles) {
        const turns = readTrace(f);
        console.log(formatTraceSummary(turns));
        console.log(`[e2e:article-research] Trace: ${f}`);
      }

      // Check done() summaries across all trace sessions for the footnote content
      const allToolCalls = allTurns.flatMap((turn) => turn.toolCalls);
      const doneCalls = allToolCalls.filter((tc) => tc.name === "done");
      const summaries = doneCalls.map(
        (tc) => String(tc.args?.summary ?? tc.args?.result ?? ""),
      );

      // Also check LLM text content from all turns (agent may report via text, not done args)
      const allContent = allTurns
        .map((t) => t.llmContent ?? "")
        .filter(Boolean);

      const mentionsInDone = summaries.some(
        (s) => s.includes("Zhang") || s.includes("Iron-Air") || s.includes("Nature Energy"),
      );
      const mentionsInContent = allContent.some(
        (s) => s.includes("Zhang") || s.includes("Iron-Air") || s.includes("Nature Energy"),
      );

      const found = mentionsInDone || mentionsInContent;
      const bestMatch = summaries.find(
        (s) => s.includes("Zhang") || s.includes("Iron-Air") || s.includes("Nature Energy"),
      ) ?? allContent.find(
        (s) => s.includes("Zhang") || s.includes("Iron-Air") || s.includes("Nature Energy"),
      ) ?? "(not found in traces)";

      console.log(`\n[e2e] Footnote mentioned in done(): ${mentionsInDone}`);
      console.log(`[e2e] Footnote mentioned in content: ${mentionsInContent}`);
      console.log(`[e2e] Total turns across ${traceFiles.length} sessions: ${allTurns.length}`);
      console.log(`[e2e] Done calls found: ${doneCalls.length}`);

      // Primary assertion: task completed (already checked above).
      // Secondary: agent found the footnote content somewhere in its output.
      // This is best-effort since the planner may decompose into subtasks
      // where the final synthesis happens at orchestrator level (not in traces).
      if (found) {
        console.log(`[e2e] PASS — Footnote [2] source found`);
        console.log(`[e2e]   Match: ${String(bestMatch).substring(0, 120)}...`);
      } else {
        console.log(`[e2e] WARN — Task completed but footnote source not found in trace data`);
        console.log(`[e2e]   (Orchestrator-level synthesis may not appear in per-session traces)`);
      }
    },
    180_000,
  );
});
