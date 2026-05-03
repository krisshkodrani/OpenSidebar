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
  | "fireworks-deepseek"
  | "moonshot"
  | "xiaomi";
type E2ELane = "dev" | "validation";

function isDiagnosticModeEnabled(): boolean {
  return process.env.E2E_DIAGNOSTIC === "true";
}

export interface E2EHarness {
  apiKey: string | undefined;
  providerMode: ProviderMode;
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

function loadOpenAiApiKey(): string | undefined {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  if (!existsSync(REPO_ENV_PATH)) return undefined;
  const content = readFileSync(REPO_ENV_PATH, "utf-8");
  const match = content.match(/OPENAI_API_KEY=(.+)/);
  return match?.[1]?.trim() || undefined;
}

function loadFireworksApiKey(): string | undefined {
  if (process.env.FIREWORKS_API_KEY) return process.env.FIREWORKS_API_KEY;
  if (!existsSync(REPO_ENV_PATH)) return undefined;
  const content = readFileSync(REPO_ENV_PATH, "utf-8");
  const match = content.match(/FIREWORKS_API_KEY=(.+)/);
  return match?.[1]?.trim() || undefined;
}

function loadDeepSeekApiKey(): string | undefined {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  if (!existsSync(REPO_ENV_PATH)) return undefined;
  const content = readFileSync(REPO_ENV_PATH, "utf-8");
  const match = content.match(/DEEPSEEK_API_KEY=(.+)/);
  return match?.[1]?.trim() || undefined;
}

function loadKimiApiKey(): string | undefined {
  if (process.env.KIMI_API_KEY) return process.env.KIMI_API_KEY;
  if (!existsSync(REPO_ENV_PATH)) return undefined;
  const content = readFileSync(REPO_ENV_PATH, "utf-8");
  const match = content.match(/KIMI_API_KEY=(.+)/);
  return match?.[1]?.trim() || undefined;
}

function loadXiaomiApiKey(): string | undefined {
  if (process.env.XIAOMI_API_KEY) return process.env.XIAOMI_API_KEY;
  if (!existsSync(REPO_ENV_PATH)) return undefined;
  const content = readFileSync(REPO_ENV_PATH, "utf-8");
  const match = content.match(/XIAOMI_API_KEY=(.+)/);
  return match?.[1]?.trim() || undefined;
}

/** Detect provider mode from E2E_PROVIDER env var (default: fireworks) */
function detectProviderMode(): ProviderMode {
  const prov = process.env.E2E_PROVIDER?.toLowerCase();
  if (prov === "deepseek" || prov === "fireworks-deepseek")
    return "fireworks-deepseek";
  if (prov === "moonshot" || prov === "kimi") return "moonshot";
  if (prov === "xiaomi" || prov === "mimo") return "xiaomi";
  if (prov === "groq" || prov === "openrouter-groq") return "openrouter-groq";
  if (prov === "openai-groq") return "openai-groq";
  if (prov === "openrouter") return "openrouter";
  return "fireworks";
}

function loadActiveProviderApiKey(
  providerMode: ProviderMode,
): string | undefined {
  if (providerMode === "fireworks-deepseek") {
    const fireworksKey = loadFireworksApiKey();
    const deepseekKey = loadDeepSeekApiKey();
    return fireworksKey && deepseekKey ? fireworksKey : undefined;
  }
  if (providerMode === "fireworks") return loadFireworksApiKey();
  if (providerMode === "moonshot") return loadKimiApiKey();
  if (providerMode === "xiaomi") return loadXiaomiApiKey();
  if (providerMode === "openai-groq") return loadOpenAiApiKey();
  return loadApiKey();
}

function deriveLane(providerMode: ProviderMode): E2ELane {
  return providerMode === "fireworks" ||
    providerMode === "fireworks-deepseek" ||
    providerMode === "moonshot" ||
    providerMode === "xiaomi"
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

  return filterTraceFilesByWorkspace(
    findAllNewTraceFiles(tracesBefore),
    workspaceId,
  );
}

export function createE2EHarness(options: HarnessOptions = {}): E2EHarness {
  const maxTurns = options.maxTurns ?? 20;
  const testLabel = options.testLabel ?? "e2e";

  const providerMode = detectProviderMode();
  const apiKey = loadActiveProviderApiKey(providerMode);

  let ctx: ExtensionContext;
  let page: Page;
  let detachConsole: (() => void) | null = null;
  let tracesBefore: Set<string> = new Set();
  let testStartTime = 0;

  const harness: E2EHarness = {
    apiKey,
    providerMode,

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
        pages.find(
          (candidate) => !candidate.url().startsWith("chrome-extension://"),
        ) || (await ctx.browser.newPage());

      const helper = await openHelperPage(ctx);
      const lane = deriveLane(providerMode);
      const groqKey =
        providerMode === "openrouter-groq" || providerMode === "openai-groq"
          ? loadGroqApiKey()
          : undefined;
      const openAiKey =
        providerMode === "openai-groq" ? loadOpenAiApiKey() : undefined;
      const openRouterKey =
        providerMode === "openrouter" || providerMode === "openrouter-groq"
          ? loadApiKey()
          : undefined;
      const fireworksKey =
        providerMode === "fireworks" || providerMode === "fireworks-deepseek"
          ? loadFireworksApiKey()
          : undefined;
      const deepseekKey =
        providerMode === "fireworks-deepseek"
          ? loadDeepSeekApiKey()
          : undefined;
      const kimiKey =
        providerMode === "moonshot" ? loadKimiApiKey() : undefined;
      const xiaomiKey =
        providerMode === "xiaomi" ? loadXiaomiApiKey() : undefined;
      const executorModel = process.env.E2E_EXECUTOR_MODEL || undefined;
      const temperature = process.env.E2E_TEMPERATURE
        ? parseFloat(process.env.E2E_TEMPERATURE)
        : undefined;
      const perceptionMode =
        process.env.E2E_PERCEPTION_MODE ||
        (process.env.E2E_USE_VL_EXECUTOR === "true" ? "unified_vl" : undefined);
      suiteReport.setRunMetadata({
        provider: providerMode,
        lane,
        configuredExecutorModel: executorModel ?? null,
        diagnosticMode,
      });
      await helper.evaluate(
        async (
          openRouterKey: string | null,
          turns: number,
          mode: string,
          gKey: string | null,
          openAiKey: string | null,
          fwKey: string | null,
          deepseekKey: string | null,
          kimiKey: string | null,
          xiaomiKey: string | null,
          execModel: string | null,
          temp: number | null,
          perceptionMode: string | null,
        ) => {
          const localData: Record<string, string> = {};
          if (openRouterKey) localData.openRouterApiKey_local = openRouterKey;
          if (gKey) localData.groqApiKey_local = gKey;
          if (openAiKey) localData.openaiApiKey_local = openAiKey;
          if (fwKey) localData.fireworksApiKey_local = fwKey;
          if (deepseekKey) localData.deepseekApiKey_local = deepseekKey;
          if (kimiKey) localData.kimiApiKey_local = kimiKey;
          if (xiaomiKey) localData.xiaomiApiKey_local = xiaomiKey;
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
          if (perceptionMode) settings.perceptionMode = perceptionMode;
          await chrome.storage.sync.set({ userSettings: settings });
        },
        openRouterKey ?? null,
        maxTurns,
        providerMode,
        groqKey ?? null,
        openAiKey ?? null,
        fireworksKey ?? null,
        deepseekKey ?? null,
        kimiKey ?? null,
        xiaomiKey ?? null,
        executorModel ?? null,
        temperature ?? null,
        perceptionMode ?? null,
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
