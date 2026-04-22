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
const REPO_ENV_PATH = resolve(__dirname, "../../../../../.env");

export interface HarnessOptions {
  maxTurns?: number;
  testLabel?: string;
}

type ProviderMode =
  | "openrouter"
  | "openrouter-groq"
  | "openai-groq"
  | "fireworks"
  | "moonshot";
type E2ELane = "dev" | "validation";

function isDiagnosticModeEnabled(): boolean {
  return process.env.E2E_DIAGNOSTIC === "true";
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
  if (!existsSync(REPO_ENV_PATH)) return undefined;
  const content = readFileSync(REPO_ENV_PATH, "utf-8");
  const match = content.match(/OPENROUTER_API_KEY=(.+)/);
  return match?.[1]?.trim() || undefined;
}

function loadGroqApiKey(): string | undefined {
  if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY;
  if (!existsSync(REPO_ENV_PATH)) return undefined;
  const content = readFileSync(REPO_ENV_PATH, "utf-8");
  const match = content.match(/GROQ_API_KEY=(.+)/);
  return match?.[1]?.trim() || undefined;
}

function loadFireworksApiKey(): string | undefined {
  if (process.env.FIREWORKS_API_KEY) return process.env.FIREWORKS_API_KEY;
  if (!existsSync(REPO_ENV_PATH)) return undefined;
  const content = readFileSync(REPO_ENV_PATH, "utf-8");
  const match = content.match(/FIREWORKS_API_KEY=(.+)/);
  return match?.[1]?.trim() || undefined;
}

function loadKimiApiKey(): string | undefined {
  if (process.env.KIMI_API_KEY) return process.env.KIMI_API_KEY;
  if (!existsSync(REPO_ENV_PATH)) return undefined;
  const content = readFileSync(REPO_ENV_PATH, "utf-8");
  const match = content.match(/KIMI_API_KEY=(.+)/);
  return match?.[1]?.trim() || undefined;
}

/** Detect provider mode from E2E_PROVIDER env var (default: fireworks) */
function detectProviderMode(): ProviderMode {
  const prov = process.env.E2E_PROVIDER?.toLowerCase();
  if (prov === "moonshot" || prov === "kimi") return "moonshot";
  if (prov === "groq" || prov === "openrouter-groq") return "openrouter-groq";
  if (prov === "openai-groq") return "openai-groq";
  if (prov === "openrouter") return "openrouter";
  return "fireworks";
}

function deriveLane(providerMode: ProviderMode): E2ELane {
  return providerMode === "fireworks" || providerMode === "moonshot"
    ? "dev"
    : "validation";
}

async function waitForTraceFiles(
  tracesBefore: Set<string>,
  workspaceId?: string | null,
  timeoutMs: number = 2_000,
): Promise<string[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const traceFiles = filterTraceFilesByWorkspace(
      findAllNewTraceFiles(tracesBefore),
      workspaceId,
    );
    if (traceFiles.length > 0) return traceFiles;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return filterTraceFilesByWorkspace(findAllNewTraceFiles(tracesBefore), workspaceId);
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
      const diagnosticMode = isDiagnosticModeEnabled();
      detachConsole = await attachSwConsole(ctx.browser, { diagnosticMode });

      const pages = await ctx.browser.pages();
      page =
        pages.find((candidate) => !candidate.url().startsWith("chrome-extension://")) ||
        (await ctx.browser.newPage());

      const helper = await openHelperPage(ctx);
      const providerMode = detectProviderMode();
      const lane = deriveLane(providerMode);
      const groqKey =
        providerMode !== "openrouter" && providerMode !== "moonshot"
          ? loadGroqApiKey()
          : undefined;
      const fireworksKey = providerMode === "fireworks" ? loadFireworksApiKey() : undefined;
      const kimiKey = providerMode === "moonshot" ? loadKimiApiKey() : undefined;
      const executorModel = process.env.E2E_EXECUTOR_MODEL || undefined;
      const temperature = process.env.E2E_TEMPERATURE ? parseFloat(process.env.E2E_TEMPERATURE) : undefined;
      const useVLExecutor = process.env.E2E_USE_VL_EXECUTOR === "true" || undefined;
      suiteReport.setRunMetadata({
        provider: providerMode,
        lane,
        configuredExecutorModel: executorModel ?? null,
        diagnosticMode,
      });
      await helper.evaluate(
        async (key: string, turns: number, mode: string, gKey: string | null, fwKey: string | null, kimiKey: string | null, execModel: string | null, temp: number | null, vlExec: boolean | null) => {
          const localData: Record<string, string> = { openRouterApiKey_local: key };
          if (gKey) localData.groqApiKey_local = gKey;
          if (fwKey) localData.fireworksApiKey_local = fwKey;
          if (kimiKey) localData.kimiApiKey_local = kimiKey;
          await chrome.storage.local.set(localData);
          const settings: Record<string, unknown> = {
            requireApprovals: false,
            allowNavigation: false,
            requirePlanConfirmation: false,
            showElementTags: false,
            maxTurns: turns,
            providerMode: mode,
          };
          if (execModel) settings.executorModel = execModel;
          if (temp !== null) settings.temperature = temp;
          if (vlExec) settings.useVLExecutor = true;
          await chrome.storage.sync.set({ userSettings: settings });
        },
        apiKey ?? "",
        maxTurns,
        providerMode,
        groqKey ?? null,
        fireworksKey ?? null,
        kimiKey ?? null,
        executorModel ?? null,
        temperature ?? null,
        useVLExecutor ?? null,
      );

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
      const traceFiles = await waitForTraceFiles(tracesBefore, workspaceId);
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
