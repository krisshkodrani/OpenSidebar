import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, relative, resolve } from "path";
import { fileURLToPath } from "url";
import {
  closeExtension,
  launchWithExtension,
  openHelperPage,
} from "../apps/extension/tests/e2e/helpers/browser";
import {
  getFixtureUrl,
  startFixtureServer,
  stopFixtureServer,
} from "../apps/extension/tests/e2e/helpers/fixture-server";

interface SmokeState {
  activeTab?: {
    id?: number;
    title?: string;
    url?: string;
    windowId?: number;
  } | null;
  sidePanelOptions?: {
    enabled?: boolean;
    path?: string;
    tabId?: number;
  } | null;
  userOpenedPanel?: number[];
  workspace?: {
    id: string;
    name?: string;
    tabIds: number[];
  } | null;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const repoEnvPath = resolve(repoRoot, ".env");

function parseArg(name: string): string | null {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function readEnvValue(name: string): string | undefined {
  const fromProcess = process.env[name]?.trim();
  if (fromProcess) return fromProcess;
  if (!existsSync(repoEnvPath)) return undefined;
  const content = readFileSync(repoEnvPath, "utf-8");
  const match = content.match(new RegExp(`^${name}=(.+)$`, "m"));
  return match?.[1]?.trim().replace(/^["']|["']$/g, "") || undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readGitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function artifactPath(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const stamp = now
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .replace("Z", "");
  return resolve(
    repoRoot,
    ".artifacts",
    "e2e",
    "native-sidepanel",
    date,
    `native-sidepanel-smoke-${stamp}.json`,
  );
}

async function readSmokeState(
  helper: Awaited<ReturnType<typeof openHelperPage>>,
  tabId: number,
): Promise<SmokeState> {
  return helper.evaluate(async (targetTabId: number) => {
    const [storage, session, activeTabs] = await Promise.all([
      chrome.storage.local.get("opensidebar:workspaces"),
      chrome.storage.session.get("userOpenedPanel"),
      chrome.tabs.query({ active: true, currentWindow: true }),
    ]);
    const workspaces =
      (storage["opensidebar:workspaces"] as
        | Array<{ id: string; name?: string; tabIds: number[] }>
        | undefined) ?? [];
    const workspace =
      workspaces.find((item) => item.tabIds.includes(targetTabId)) ?? null;
    const sidePanelOptions = await chrome.sidePanel
      .getOptions({ tabId: targetTabId })
      .catch(() => null);
    const activeTab = activeTabs[0] ?? null;
    return {
      activeTab: activeTab
        ? {
            id: activeTab.id,
            title: activeTab.title,
            url: activeTab.url,
            windowId: activeTab.windowId,
          }
        : null,
      sidePanelOptions,
      userOpenedPanel: session.userOpenedPanel ?? [],
      workspace,
    };
  }, tabId);
}

function printHelp(): void {
  console.log(`Native side-panel smoke

Launches Chrome with dist/ loaded, opens a fixture tab, and waits for a real
Chrome toolbar click to open the native side panel.

Usage:
  npm run release:smoke:native-panel -- --timeoutMs=120000

Options:
  --route=<fixture route>      Fixture route to open. Default: login
  --timeoutMs=<ms>            Time to wait for the manual toolbar click. Default: 120000
  --holdMs=<ms>               Time to keep Chrome open after success. Default: 5000
  --no-provider-seed          Do not seed Fireworks settings even if FIREWORKS_API_KEY exists
  --help                      Show this help
`);
}

async function main(): Promise<void> {
  if (hasFlag("help")) {
    printHelp();
    return;
  }

  process.env.E2E_PROFILE = "headed";
  process.env.E2E_ARTIFACTS = "no-panel";

  const route = parseArg("route") ?? "login";
  const timeoutMs = Number(parseArg("timeoutMs") ?? "120000");
  const holdMs = Number(parseArg("holdMs") ?? "5000");
  const shouldSeedProvider = !hasFlag("no-provider-seed");
  const fireworksKey = shouldSeedProvider
    ? readEnvValue("FIREWORKS_API_KEY")
    : undefined;
  const startedAt = new Date().toISOString();
  const outputPath = artifactPath();
  let lastState: SmokeState | null = null;

  await startFixtureServer();
  const ctx = await launchWithExtension();
  try {
    const page = await ctx.browser.newPage();
    await page.goto(getFixtureUrl(route), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const fixtureUrl = page.url();
    const helper = await openHelperPage(ctx);
    const tabId = await helper.evaluate(async (url: string) => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((tab) => tab.url === url)?.id ?? -1;
    }, fixtureUrl);
    if (tabId <= 0) throw new Error("Could not resolve fixture tab.");

    if (fireworksKey) {
      await helper.evaluate(async (key: string) => {
        await chrome.storage.local.set({
          fireworksApiKey_local: key,
          openRouterApiKey_local: "",
          openaiApiKey_local: "",
          groqApiKey_local: "",
          geminiApiKey_local: "",
          deepseekApiKey_local: "",
          kimiApiKey_local: "",
          xiaomiApiKey_local: "",
        });
        await chrome.storage.sync.set({
          userSettings: {
            providerMode: "fireworks",
            requireApprovals: false,
            allowNavigation: false,
            requirePlanConfirmation: false,
            showElementTags: false,
          },
        });
      }, fireworksKey);
    }

    await helper.evaluate(async (targetTabId: number) => {
      const tab = await chrome.tabs.get(targetTabId);
      if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(targetTabId, { active: true });
    }, tabId);
    await page.bringToFront();

    console.log(`[native-sidepanel-smoke] Fixture: ${fixtureUrl}`);
    console.log(`[native-sidepanel-smoke] Extension: ${ctx.extensionId}`);
    console.log(
      "[native-sidepanel-smoke] Click the OpenSidebar toolbar icon in the Chrome window.",
    );
    console.log(
      `[native-sidepanel-smoke] Waiting up to ${timeoutMs}ms for the side panel handshake.`,
    );

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      lastState = await readSmokeState(helper, tabId);
      if (
        lastState.workspace &&
        lastState.sidePanelOptions?.path === "src/sidepanel/index.html"
      ) {
        const evidence = {
          result: "passed",
          startedAt,
          completedAt: new Date().toISOString(),
          commit: readGitCommit(),
          route,
          fixtureUrl,
          extensionId: ctx.extensionId,
          tabId,
          providerSeeded: Boolean(fireworksKey),
          state: lastState,
        };
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
        console.log(
          `[native-sidepanel-smoke] Passed. Evidence: ${relative(repoRoot, outputPath)}`,
        );
        if (holdMs > 0) {
          console.log(`[native-sidepanel-smoke] Holding Chrome open for ${holdMs}ms.`);
          await sleep(holdMs);
        }
        return;
      }
      await sleep(500);
    }

    const evidence = {
      result: "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      commit: readGitCommit(),
      route,
      fixtureUrl,
      extensionId: ctx.extensionId,
      tabId,
      providerSeeded: Boolean(fireworksKey),
      lastState,
      reason: "Timed out waiting for a workspace created by native side-panel open.",
    };
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
    throw new Error(
      `Timed out waiting for native side-panel handshake. Evidence: ${relative(
        repoRoot,
        outputPath,
      )}`,
    );
  } finally {
    await closeExtension(ctx).catch(() => {});
    await stopFixtureServer().catch(() => {});
  }
}

main().catch((error) => {
  console.error(
    "[native-sidepanel-smoke] Failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
