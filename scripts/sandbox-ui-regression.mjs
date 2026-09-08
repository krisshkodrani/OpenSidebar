#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";
import { AxePuppeteer } from "@axe-core/puppeteer";

const root = process.cwd();
const update = process.argv.includes("--update");
const port = 4326;
const origin = `http://127.0.0.1:${port}`;
const baselineDirectory = path.join(
  root,
  "apps",
  "sandbox",
  "tests",
  "visual-baselines",
);
const artifactDirectory = path.join(root, ".artifacts", "sandbox-ui");
mkdirSync(artifactDirectory, { recursive: true });
if (update) mkdirSync(baselineDirectory, { recursive: true });

const now = "2026-08-13T12:00:00.000Z";
const run = {
  id: "r_visual",
  scenarioId: "restock-alert",
  scenarioVersion: 1,
  lifecycle: "ready",
  revision: 1,
  createdAt: now,
  updatedAt: now,
  expiresAt: "2026-08-14T12:00:00.000Z",
  result: null,
  state: {
    product: "Nimbus Running Shoe",
    availability: "out_of_stock",
    inventory: 0,
    priceCents: 12900,
    relevance: "relevant",
    visualOnly: false,
    decoration: "standard",
    transitionAt: null,
    feasibility: "feasible",
    cartQuantity: 0,
    cartSize: null,
  },
};
const account = {
  schemaVersion: 1,
  accountId: "acct_visual",
  email: "designer@example.com",
  cloudAccess: true,
  sessionEpoch: 1,
};
const preferences = {
  schemaVersion: 1,
  revision: 1,
  inferenceMode: "local",
  providerMode: "openrouter",
  maxTurns: 100,
  theme: "system",
  showSessionMetrics: true,
};
const usage = {
  schemaVersion: 1,
  periodStart: "2026-08-01",
  requests: 42,
  inputTokens: 12000,
  outputTokens: 3400,
  concurrentStreams: 0,
  limits: { requests: 2000, tokens: 10000000, concurrentStreams: 3 },
};
const devices = [
  {
    schemaVersion: 1,
    id: "device_visual",
    installationId: "install_visual",
    displayName: "Work Chrome",
    displayNameRevision: 1,
    extensionVersion: "0.7.3",
    connectionKind: "browser_extension",
    availability: "online",
    createdAt: now,
    lastSeenAt: now,
  },
];
const credentials = [
  {
    schemaVersion: 1,
    provider: "openrouter",
    configured: true,
    fingerprint: "abc123",
    lastVerifiedAt: now,
    verification: "valid",
  },
  {
    schemaVersion: 1,
    provider: "fireworks",
    configured: false,
    verification: "never",
  },
];
const modelBenchBase = {
  scenarioId: "visual-regression",
  scenarioVersion: 1,
  revision: 2,
  lifecycle: "active",
  route: "/records/renewal",
  data: {
    applicationFamily: "crm",
    case: {
      title: "Renewal escalation",
      status: "Needs review",
      value: "High priority",
    },
    interaction: {
      mutable: true,
      requiresValue: true,
      activeSection: "Tickets",
      control: "select",
      options: ["Normal", "High priority"],
      valueLabel: "Priority",
      submitLabel: "Save priority",
    },
    evidence: [
      { label: "Account", value: "Northstar Labs" },
      { label: "Renewal date", value: "August 30" },
    ],
  },
};
const modelBenchInterrupted = {
  ...modelBenchBase,
  data: {
    ...modelBenchBase.data,
    workflow: [
      {
        id: "review",
        title: "Review account",
        detail: "Confirm the account and contract.",
        status: "complete",
        actionLabel: "Reviewed",
      },
      {
        id: "verify",
        title: "Verify renewal",
        detail: "Check the renewal state before changing priority.",
        status: "active",
        actionLabel: "Verify",
      },
      {
        id: "update",
        title: "Update record",
        detail: "Apply the requested priority.",
        status: "pending",
        actionLabel: "Continue",
      },
    ],
    workflowState: {
      currentIndex: 1,
      requiresRecovery: true,
      status: "active",
    },
    dynamics: {
      trigger: "The record refreshed while you were reviewing it.",
      recoveryLabel: "Reload current record",
    },
  },
};
const modelBenchTable = {
  ...modelBenchBase,
  data: {
    ...modelBenchBase.data,
    applicationFamily: "records",
    presentation: {
      kind: "clipped-table",
      items: [
        {
          label: "Northstar Labs",
          code: "CONTRACT-2026-004182",
          clipped: true,
        },
        { label: "Acme Systems", code: "CONTRACT-2026-004201", clipped: false },
      ],
    },
  },
};

function json(request, body, status = 200) {
  return request.respond({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockApi(page, authenticated, targetState) {
  let savedPreferences = { ...preferences };
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return request.continue();
    if (url.pathname.endsWith("/auth/session"))
      return void json(request, {
        authenticated,
        email: authenticated ? account.email : undefined,
        csrfToken: authenticated ? "csrf_visual" : undefined,
      });
    if (url.pathname === "/api/v1/playground/runs")
      return void json(request, { runs: authenticated ? [run] : [] });
    if (url.pathname === "/api/v1/dashboard/summary")
      return void json(request, {
        schemaVersion: 1,
        account,
        devices,
        credentials,
        preferences,
        usage,
        sessions: { enabled: true, authorized: true, recent: [] },
        detailedTraces: "local_only",
      });
    if (url.pathname === "/api/v1/account") return void json(request, account);
    if (url.pathname === "/api/v1/account/devices")
      return void json(request, { devices });
    if (url.pathname === "/api/v1/credentials")
      return void json(request, { credentials });
    if (url.pathname === "/api/v1/relay/usage")
      return void json(request, usage);
    if (url.pathname === "/api/v1/preferences") {
      if (request.method() === "PUT")
        savedPreferences = JSON.parse(request.postData() || "{}");
      return void json(request, savedPreferences);
    }
    if (url.pathname === "/api/v1/account/remote-work")
      return void json(request, {
        schemaVersion: 1,
        enabled: false,
        revision: 1,
        updatedAt: now,
      });
    if (url.pathname === "/api/v1/traces")
      return void json(request, { schemaVersion: 1, traces: [] });
    if (url.pathname === "/api/v1/traces/usage")
      return void json(request, {
        schemaVersion: 1,
        usedBytes: 0,
        traceCount: 0,
        limitBytes: 524288000,
      });
    if (url.pathname === "/api/v2/target/state" && targetState)
      return void json(request, { run: targetState });
    if (
      url.pathname === "/api/v1/target/state" ||
      url.pathname === "/api/v2/target/state"
    )
      return void json(
        request,
        { error: { message: "That session has ended." } },
        404,
      );
    return void json(
      request,
      { error: { message: `Unhandled visual-test API route ${url.pathname}` } },
      404,
    );
  });
}

const cases = [
  {
    name: "playground-public-light-desktop",
    route: "/app/playground",
    width: 1440,
    height: 900,
    auth: false,
    mode: "light",
  },
  {
    name: "playground-public-light-mobile",
    route: "/app/playground",
    width: 390,
    height: 844,
    auth: false,
    mode: "light",
  },
  {
    name: "playground-public-light-tablet",
    route: "/app/playground",
    width: 768,
    height: 1024,
    auth: false,
    mode: "light",
  },
  {
    name: "playground-public-light-narrow",
    route: "/app/playground",
    width: 320,
    height: 720,
    auth: false,
    mode: "light",
  },
  {
    name: "playground-public-dark-mobile",
    route: "/app/playground",
    width: 390,
    height: 844,
    auth: false,
    mode: "dark",
  },
  {
    name: "playground-active-desktop",
    route: "/app/playground",
    width: 1440,
    height: 900,
    auth: true,
    mode: "light",
  },
  {
    name: "playground-active-mobile",
    route: "/app/playground",
    width: 390,
    height: 844,
    auth: true,
    mode: "light",
  },
  {
    name: "playground-active-narrow",
    route: "/app/playground",
    width: 320,
    height: 720,
    auth: true,
    mode: "light",
  },
  {
    name: "dashboard-desktop",
    route: "/app",
    width: 1440,
    height: 900,
    auth: true,
    mode: "light",
  },
  {
    name: "settings-desktop",
    route: "/app/settings",
    width: 1440,
    height: 900,
    auth: true,
    mode: "light",
  },
  {
    name: "viewer-mobile",
    route: "/app/viewer",
    width: 390,
    height: 844,
    auth: true,
    mode: "light",
  },
  {
    name: "target-expired-mobile",
    route: "/target.html",
    width: 390,
    height: 844,
    auth: false,
    mode: "light",
  },
  {
    name: "modelbench-expired-mobile",
    route: "/scenario-target.html",
    width: 390,
    height: 844,
    auth: false,
    mode: "light",
  },
  {
    name: "modelbench-expired-narrow",
    route: "/scenario-target.html",
    width: 320,
    height: 720,
    auth: false,
    mode: "light",
  },
  {
    name: "modelbench-standard-desktop",
    route: "/scenario-target.html",
    width: 1440,
    height: 900,
    auth: false,
    mode: "light",
    targetState: modelBenchBase,
  },
  {
    name: "modelbench-interrupted-mobile",
    route: "/scenario-target.html",
    width: 390,
    height: 844,
    auth: false,
    mode: "light",
    targetState: modelBenchInterrupted,
  },
  {
    name: "modelbench-table-tablet",
    route: "/scenario-target.html",
    width: 768,
    height: 1024,
    auth: false,
    mode: "light",
    targetState: modelBenchTable,
  },
];

const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--config",
    "apps/sandbox/vite.config.ts",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  { cwd: root, stdio: "ignore", windowsHide: true },
);
try {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {
      /* server is starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const browser = await puppeteer.launch({
    headless: true,
    executablePath:
      process.env.SANDBOX_UI_CHROME_PATH ||
      (process.platform === "win32"
        ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
        : puppeteer.executablePath()),
    userDataDir: path.join(artifactDirectory, "chrome-profile"),
    args: ["--no-first-run", "--disable-gpu"],
  });
  const failures = [];
  try {
    for (const item of cases) {
      console.log(`[sandbox-ui] capture ${item.name}`);
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(10_000);
      await page.setViewport({
        width: item.width,
        height: item.height,
        deviceScaleFactor: 1,
      });
      await mockApi(page, item.auth, item.targetState);
      await page.evaluateOnNewDocument(
        (mode) => localStorage.setItem("opensidebar:control:color-mode", mode),
        item.mode,
      );
      await page
        .goto(`${origin}${item.route}`, { waitUntil: "domcontentloaded" })
        .catch((error) => {
          if (!String(error).includes("Navigation timeout")) throw error;
        });
      await page.waitForSelector("#root > *", { timeout: 10_000 });
      await new Promise((resolve) => setTimeout(resolve, 700));
      await page.addStyleTag({
        content:
          "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}",
      });
      await page.evaluate(() => document.fonts.ready);
      const metrics = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        page: document.documentElement.scrollWidth,
        title: document.title,
        focusables: document.querySelectorAll(
          'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])',
        ).length,
      }));
      if (metrics.page > metrics.viewport)
        failures.push(
          `${item.name}: horizontal overflow ${metrics.page}px > ${metrics.viewport}px`,
        );
      if (metrics.focusables === 0)
        failures.push(
          `${item.name}: no keyboard-focusable recovery or interaction`,
        );
      const accessibility = await new AxePuppeteer(page)
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      for (const violation of accessibility.violations.filter(
        (entry) => entry.impact === "serious" || entry.impact === "critical",
      )) {
        failures.push(
          `${item.name}: ${violation.impact} accessibility violation ${violation.id} at ${violation.nodes.map((node) => node.target.join(" ")).join(", ")} — ${violation.nodes[0]?.failureSummary ?? violation.help}`,
        );
      }
      if (item.name === "playground-public-light-mobile") {
        await page.evaluate(() =>
          Array.from(document.querySelectorAll("button"))
            .find((button) => button.textContent?.trim() === "Menu")
            ?.click(),
        );
        await page.waitForSelector('[role="dialog"]');
        await new Promise((resolve) => setTimeout(resolve, 100));
        const focusInDialog = await page.evaluate(() =>
          Boolean(document.activeElement?.closest('[role="dialog"]')),
        );
        if (!focusInDialog)
          failures.push(
            `${item.name}: mobile navigation did not move focus into the dialog`,
          );
        await page.keyboard.press("Escape");
        const focusRestored = await page.evaluate(
          () => document.activeElement?.textContent?.trim() === "Menu",
        );
        if (!focusRestored)
          failures.push(
            `${item.name}: mobile navigation did not restore focus to Menu`,
          );
      }
      const artifact = path.join(artifactDirectory, `${item.name}.png`);
      await page.screenshot({ path: artifact });
      const baseline = path.join(baselineDirectory, `${item.name}.png`);
      if (update) writeFileSync(baseline, readFileSync(artifact));
      else if (!existsSync(baseline))
        failures.push(
          `${item.name}: missing baseline (run npm run sandbox:ui:update)`,
        );
      else {
        const actualHash = createHash("sha256")
          .update(readFileSync(artifact))
          .digest("hex");
        const expectedHash = createHash("sha256")
          .update(readFileSync(baseline))
          .digest("hex");
        if (actualHash !== expectedHash)
          failures.push(
            `${item.name}: visual baseline changed (${expectedHash.slice(0, 8)} -> ${actualHash.slice(0, 8)})`,
          );
      }
      if (item.name === "settings-desktop") {
        const themeSelect = await page.evaluateHandle(() =>
          Array.from(document.querySelectorAll("label"))
            .find((label) => label.textContent?.includes("Theme"))
            ?.querySelector("select"),
        );
        await themeSelect.asElement()?.select("dark");
        await page.evaluate(() =>
          Array.from(document.querySelectorAll("button"))
            .find(
              (button) =>
                button.textContent?.trim() === "Save synced preferences",
            )
            ?.click(),
        );
        await page.waitForFunction(() =>
          document.documentElement.classList.contains("dark"),
        );
        const persisted = await page.evaluate(() =>
          localStorage.getItem("opensidebar:control:color-mode"),
        );
        if (persisted !== "dark")
          failures.push(
            `${item.name}: saved dark mode was not persisted or applied immediately`,
          );
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  if (failures.length) throw new Error(failures.join("\n"));
  console.log(
    `[sandbox-ui] ${cases.length} visual states passed overflow, focusability, and baseline checks.`,
  );
} finally {
  server.kill();
}
