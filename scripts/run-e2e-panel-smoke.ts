import { closeExtension, ensureE2EPanel, launchWithExtension, openHelperPage } from "../apps/extension/tests/e2e/helpers/browser";
import {
  getFixtureUrl,
  startFixtureServer,
  stopFixtureServer,
} from "../apps/extension/tests/e2e/helpers/fixture-server";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ENV_PATH = resolve(__dirname, "../.env");

function parseArg(name: string): string | null {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function readEnvValue(name: string): string | undefined {
  const fromProcess = process.env[name]?.trim();
  if (fromProcess) return fromProcess;
  if (!existsSync(REPO_ENV_PATH)) return undefined;
  const content = readFileSync(REPO_ENV_PATH, "utf-8");
  const match = content.match(new RegExp(`^${name}=(.+)$`, "m"));
  return match?.[1]?.trim().replace(/^["']|["']$/g, "") || undefined;
}

async function main() {
  process.env.E2E_PROFILE = process.env.E2E_PROFILE || "headed";
  process.env.E2E_ARTIFACTS = process.env.E2E_ARTIFACTS || "panel,screenshots";
  process.env.E2E_PROVIDER = "fireworks";

  const route = parseArg("route") ?? "login";
  const holdMs = Number(parseArg("holdMs") ?? "120000");
  const workspaceId = `e2e-panel-smoke-${crypto.randomUUID()}`;
  const fireworksKey = readEnvValue("FIREWORKS_API_KEY");
  if (!fireworksKey) {
    throw new Error("FIREWORKS_API_KEY is required for the panel smoke.");
  }

  await startFixtureServer();
  const ctx = await launchWithExtension();
  try {
    const pages = await ctx.browser.pages();
    const page =
      pages.find((candidate) => !candidate.url().startsWith("chrome-extension://")) ??
      (await ctx.browser.newPage());

    await page.goto(getFixtureUrl(route), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await page.bringToFront();

    const fixtureUrl = page.url();
    const helper = await openHelperPage(ctx);
    const tabId = await helper.evaluate(async (url: string) => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((tab) => tab.url === url)?.id ?? -1;
    }, fixtureUrl);
    if (tabId <= 0) throw new Error("Could not resolve active fixture tab.");

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

    await ensureE2EPanel(ctx, tabId, workspaceId);
    await page.bringToFront();

    await page.waitForFunction(
      () => {
        const host = document.getElementById("opensidebar-harness-host");
        const text = host?.shadowRoot?.textContent ?? "";
        return (
          text.includes("Hi! What can I help with?") ||
          text.includes("Open Settings")
        );
      },
      { timeout: 15_000 },
    );

    const probe = await page.evaluate(() => {
      const host = document.getElementById("opensidebar-harness-host");
      const shadowRoot = host?.shadowRoot ?? null;
      const rawConfig = document.getElementById("opensidebar-overlay-config")
        ?.textContent;
      const config = rawConfig ? JSON.parse(rawConfig) : null;
      const runtimeLogoUrl =
        window.__opensidebarOverlayRuntime?.port.getUrl(
          "public/icons/icon-128.png",
        ) ?? null;
      const rect = host?.getBoundingClientRect();
      const style = host ? getComputedStyle(host) : null;
      const text = shadowRoot?.textContent ?? "";
      const logos = Array.from(
        shadowRoot?.querySelectorAll('img[alt="OpenSidebar logo"]') ?? [],
      ).map((logo) => {
        const img = logo as HTMLImageElement;
        const logoRect = img.getBoundingClientRect();
        return {
          src: img.currentSrc || img.src,
          complete: img.complete,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          width: Math.round(logoRect.width),
          height: Math.round(logoRect.height),
        };
      });
      return {
        mounted: Boolean(host),
        dataGlass: host?.getAttribute("data-glass") ?? null,
        rect: rect
          ? {
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              left: Math.round(rect.left),
              top: Math.round(rect.top),
            }
          : null,
        display: style?.display ?? null,
        visibility: style?.visibility ?? null,
        opacity: style?.opacity ?? null,
        showsOpenSettings: text.includes("Open Settings"),
        showsReadyPrompt: text.includes("Hi! What can I help with?"),
        logoLoaded: logos.some(
          (logo) => logo.complete && logo.naturalWidth > 0,
        ),
        logos,
        configScriptUrl: config?.scriptUrl ?? null,
        configExtensionBaseUrl:
          config?.runtimeOptions?.extensionBaseUrl ?? null,
        runtimeLogoUrl,
        title: document.title,
        url: location.href,
      };
    });

    console.log(`[panel-smoke] ${JSON.stringify(probe)}`);
    if (!probe.mounted || probe.display === "none" || probe.visibility === "hidden") {
      throw new Error("Real sidepanel overlay did not mount visibly.");
    }
    if (probe.showsOpenSettings || !probe.showsReadyPrompt) {
      throw new Error("Real sidepanel overlay did not load Fireworks settings.");
    }
    if (!probe.logoLoaded) {
      throw new Error("OpenSidebar logo did not load in the overlay.");
    }

    console.log(`[panel-smoke] Holding Chrome open for ${holdMs}ms.`);
    await new Promise((resolve) => setTimeout(resolve, holdMs));
  } finally {
    await closeExtension(ctx).catch(() => {});
    await stopFixtureServer().catch(() => {});
  }
}

main().catch((error) => {
  console.error("[panel-smoke] Failed:", error);
  process.exitCode = 1;
});
