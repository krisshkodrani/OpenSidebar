/**
 * E2E test harness — centralizes lifecycle boilerplate shared across test files.
 *
 * Usage:
 *   const harness = createE2EHarness({ maxTurns: 20, testLabel: "my-suite" });
 *   beforeAll(() => harness.beforeAllHook(), 60_000);
 *   beforeEach(() => harness.beforeEachHook());
 *   afterEach(() => harness.afterEachHook(currentTestName));
 *   afterAll(() => harness.afterAllHook());
 */

import type { Page } from "puppeteer";
import {
  launchWithExtension,
  closeExtension,
  openHelperPage,
  type ExtensionContext,
} from "./browser";
import { resetExtensionState, setupEventMonitor } from "./utils";
import { startFixtureServer, stopFixtureServer } from "./fixture-server";
import {
  startLogServer,
  stopLogServer,
  snapshotTraceFiles,
  findAllNewTraceFiles,
  filterTraceFilesByWorkspace,
  readTrace,
  formatTraceSummary,
  attachSwConsole,
} from "./diagnostics";
import { suiteReport } from "./report";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export interface HarnessOptions {
  maxTurns?: number;
  testLabel?: string;
}

export interface E2EHarness {
  apiKey: string | undefined;
  readonly ctx: ExtensionContext;
  readonly page: Page;
  tracesBefore: Set<string>;

  beforeAllHook(): Promise<void>;
  beforeEachHook(): Promise<void>;
  afterEachHook(testName?: string, passed?: boolean | null): Promise<void>;
  afterAllHook(): Promise<void>;

  printTraceSummary(
    workspaceId?: string | null,
  ): Promise<{ traceFiles: string[]; turns: any[] }>;
}

export function loadApiKey(): string | undefined {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const envPath = resolve(__dirname, "../../../.env");
  if (!existsSync(envPath)) return undefined;
  const content = readFileSync(envPath, "utf-8");
  const match = content.match(/OPENROUTER_API_KEY=(.+)/);
  return match?.[1]?.trim() || undefined;
}

function loadGroqApiKey(): string | undefined {
  if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY;
  const envPath = resolve(__dirname, "../../../.env");
  if (!existsSync(envPath)) return undefined;
  const content = readFileSync(envPath, "utf-8");
  const match = content.match(/GROQ_API_KEY=(.+)/);
  return match?.[1]?.trim() || undefined;
}

/** Detect provider mode from E2E_PROVIDER env var (default: openrouter) */
function detectProviderMode(): "openrouter" | "openrouter-groq" | "openai-groq" {
  const prov = process.env.E2E_PROVIDER?.toLowerCase();
  if (prov === "groq" || prov === "openrouter-groq") return "openrouter-groq";
  if (prov === "openai-groq") return "openai-groq";
  return "openrouter";
}

export function createE2EHarness(options: HarnessOptions = {}): E2EHarness {
  const maxTurns = options.maxTurns ?? 20;
  const testLabel = options.testLabel ?? "e2e";

  const apiKey = loadApiKey();

  let ctx: ExtensionContext;
  let page: Page;
  let detachConsole: (() => void) | null = null;
  let tracesBefore: Set<string> = new Set();
  let testStartTime = 0;

  const harness: E2EHarness = {
    apiKey,

    get ctx() {
      return ctx;
    },

    get page() {
      return page;
    },

    get tracesBefore() {
      return tracesBefore;
    },
    set tracesBefore(value: Set<string>) {
      tracesBefore = value;
    },

    async beforeAllHook() {
      await startLogServer();
      await startFixtureServer();
      ctx = await launchWithExtension();
      detachConsole = await attachSwConsole(ctx.browser);

      const pages = await ctx.browser.pages();
      page =
        pages.find((candidate) => !candidate.url().startsWith("chrome-extension://")) ||
        (await ctx.browser.newPage());

      const helper = await openHelperPage(ctx);
      const providerMode = detectProviderMode();
      const groqKey = providerMode !== "openrouter" ? loadGroqApiKey() : undefined;
      const executorModel = process.env.E2E_EXECUTOR_MODEL || undefined;
      const temperature = process.env.E2E_TEMPERATURE ? parseFloat(process.env.E2E_TEMPERATURE) : undefined;
      await helper.evaluate(
        async (key: string, turns: number, mode: string, gKey: string | null, execModel: string | null, temp: number | null) => {
          const localData: Record<string, string> = { openRouterApiKey_local: key };
          if (gKey) localData.groqApiKey_local = gKey;
          await chrome.storage.local.set(localData);
          const settings: Record<string, unknown> = {
            requireApprovals: false,
            allowNavigation: false,
            requirePlanConfirmation: false,
            showElementTags: false,
            maxTurns: turns,
          };
          if (mode !== "openrouter") settings.providerMode = mode;
          if (execModel) settings.executorModel = execModel;
          if (temp !== null) settings.temperature = temp;
          await chrome.storage.sync.set({ userSettings: settings });
        },
        apiKey!,
        maxTurns,
        providerMode,
        groqKey ?? null,
        executorModel ?? null,
        temperature ?? null,
      );
      await helper.close();

      await setupEventMonitor(ctx.serviceWorker);
    },

    async beforeEachHook() {
      await resetExtensionState(ctx);
      tracesBefore = snapshotTraceFiles();
      testStartTime = Date.now();
      // resetExtensionState closes old pages and creates a fresh one.
      // Always pick up the latest non-extension page.
      const freshPages = await ctx.browser.pages();
      page =
        freshPages.find((p) => !p.url().startsWith("chrome-extension://")) ||
        (await ctx.browser.newPage());
    },

    async afterEachHook(testName?: string, passed: boolean | null = null) {
      const durationMs = testStartTime > 0 ? Date.now() - testStartTime : 0;
      if (testName) {
        const traceFiles = findAllNewTraceFiles(tracesBefore);
        suiteReport.record(testName, passed, durationMs, traceFiles);
      }
      await resetExtensionState(ctx);
    },

    async afterAllHook() {
      if (detachConsole) detachConsole();
      if (ctx) await closeExtension(ctx);
      await stopFixtureServer();
      await stopLogServer();
    },

    async printTraceSummary(workspaceId?: string | null) {
      await new Promise((r) => setTimeout(r, 2_000));
      const traceFiles = filterTraceFilesByWorkspace(
        findAllNewTraceFiles(tracesBefore),
        workspaceId,
      );
      const allTurns = traceFiles.flatMap((f) => readTrace(f));

      for (const f of traceFiles) {
        const turns = readTrace(f);
        console.log(formatTraceSummary(turns));
        console.log(`[${testLabel}] Trace: ${f}`);
      }

      if (traceFiles.length === 0) {
        console.log(`[${testLabel}] No trace file found`);
      }

      return { traceFiles, turns: allTurns };
    },
  };

  return harness;
}
