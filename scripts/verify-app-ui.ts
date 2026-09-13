import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer";
import { publicPlaygroundCatalog } from "../packages/scenario-engine/src/index.ts";

// Browser UI regression checks against deterministic account responses. No real account mutations.
const output = path.resolve(".artifacts/app-design-system");
await mkdir(output, { recursive: true });
const dist = path.resolve("apps/sandbox/dist");
let dashboardMode = "ready";
let signedIn = true;
let runs: Record<string, unknown>[] = [];
const account = { email: "design-check@example.invalid", cloudAccess: true };
const usage = {
  requests: 120,
  limits: { requests: 2000, tokens: 10000000 },
  inputTokens: 18000,
  outputTokens: 4000,
  concurrentStreams: 0,
};
const credentials = [
  { provider: "fireworks", configured: false, verification: "unverified" },
];
const preferences = {
  schemaVersion: 1,
  revision: 1,
  inferenceMode: "local",
  providerMode: "fireworks",
  maxTurns: 50,
  theme: "system",
  showSessionMetrics: true,
};
let preferenceSaves = 0;
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    let data: unknown;
    switch (url.pathname) {
      case "/api/v1/playground/auth/session":
        data = { authenticated: signedIn, csrfToken: "ui-test" };
        break;
      case "/api/v1/dashboard/summary":
        await new Promise((resolve) => setTimeout(resolve, 800));
        if (dashboardMode === "error") {
          res.writeHead(503, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error: { message: "Temporary connection error" },
            }),
          );
          return;
        }
        data = {
          account,
          credentials,
          devices: [],
          usage,
          sessions: { enabled: true, authorized: true, recent: [] },
        };
        break;
      case "/api/v1/account":
        data = account;
        break;
      case "/api/v1/account/devices":
        data = { devices: [] };
        break;
      case "/api/v1/account/remote-work":
        data = { enabled: true, revision: 1 };
        break;
      case "/api/v1/credentials":
        data = { credentials };
        break;
      case "/api/v1/relay/usage":
        data = usage;
        break;
      case "/api/v1/preferences":
        if (req.method === "PUT") preferenceSaves++;
        data = preferences;
        break;
      case "/api/v1/traces":
        data = { traces: [] };
        break;
      case "/api/v1/traces/usage":
        data = { usedBytes: 0, traceCount: 0 };
        break;
      case "/api/v2/playground/scenarios":
        data = { enabled: true, scenarios: publicPlaygroundCatalog() };
        break;
      case "/api/v2/playground/runs":
        if (req.method === "POST")
          runs = [
            {
              id: "ui-run",
              scenarioId: "price-watch",
              lifecycle: "ready",
              result: null,
              expiresAt: new Date(Date.now() + 7200000).toISOString(),
            },
          ];
        data = req.method === "POST" ? { run: runs[0] } : { runs };
        break;
      default:
        res.writeHead(404);
        res.end();
        return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
    return;
  }
  const file = url.pathname.startsWith("/playground/assets/")
    ? url.pathname.slice(1)
    : "index.html";
  const resolved = path.resolve(dist, file);
  if (!resolved.startsWith(dist + path.sep)) {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    res.writeHead(200, {
      "content-type": file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "text/html",
    });
    res.end(await readFile(resolved));
  } catch {
    res.end();
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
console.log("UI test server ready", origin);
const browser = await puppeteer.launch({
  headless: true,
  protocolTimeout: 60000,
  args: ["--no-proxy-server", "--disable-gpu"],
});
console.log("Browser launched");
const page = await browser.newPage();
await page.bringToFront();
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(String(error)));
const checks: string[] = [];
const click = async (text: string) => {
  const button = await page.waitForSelector(`button::-p-text(${text})`);
  assert.ok(button);
  await button.click();
};
try {
  console.log("Checking Overview states");
  page.setDefaultNavigationTimeout(60000);
  await page.goto("data:text/html,<p>Ready</p>");
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(origin + "/app", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() =>
    document.body.textContent?.includes("Checking connection"),
  );
  assert.equal(
    await page.evaluate(() =>
      document.body.textContent?.includes("Unavailable"),
    ),
    false,
  );
  await page.waitForFunction(() =>
    document.body.textContent?.includes("Connected"),
  );
  dashboardMode = "error";
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() =>
    document.body.textContent?.includes("Connection not checked"),
  );
  assert.equal(
    await page.evaluate(() =>
      document.body.textContent?.includes("Unavailable"),
    ),
    false,
  );
  dashboardMode = "ready";
  checks.push("loading and error states never report unavailable access");
  const routes = [
    "/app",
    "/app/playground",
    "/app/settings",
    "/app/sessions",
    "/app/viewer",
    "/app/sign-in",
  ];
  for (const route of routes) {
    console.log("Checking route", route);
    await page.goto(origin + route, { waitUntil: "networkidle0" });
    assert.equal(
      await page.$$eval("main", (nodes) => nodes.length),
      1,
      route + " main landmark",
    );
    assert.equal(
      await page.$$eval("h1", (nodes) => nodes.length),
      1,
      route + " page title",
    );
    assert.equal(
      await page.evaluate(() =>
        getComputedStyle(document.querySelector("h1")!).fontFamily.includes(
          "Georgia",
        ),
      ),
      false,
    );
    for (const width of [390, 768, 1440]) {
      await page.setViewport({ width, height: 1000 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        route + " overflow at " + width,
      );
    }
    await page.screenshot({
      path: path.join(
        output,
        (route.split("/").at(-1) || "overview") + "-light.png",
      ),
      fullPage: true,
    });
    await page.select("#web-appearance", "dark");
    await page.waitForFunction(() =>
      document.documentElement.classList.contains("dark"),
    );
    assert.equal(
      await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      ),
      "rgb(11, 17, 32)",
    );
    const contrast = await page.$eval("#app-navigation a", (element) => {
      const rgb = (value: string) =>
        value
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number);
      const luminance = (values: number[]) =>
        values
          .map((v) => {
            const c = v / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          })
          .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
      let parent: Element | null = element;
      while (
        parent &&
        getComputedStyle(parent).backgroundColor === "rgba(0, 0, 0, 0)"
      )
        parent = parent.parentElement;
      const foreground = luminance(rgb(getComputedStyle(element).color));
      const background = luminance(
        rgb(getComputedStyle(parent!).backgroundColor),
      );
      return (
        (Math.max(foreground, background) + 0.05) /
        (Math.min(foreground, background) + 0.05)
      );
    });
    assert.ok(
      contrast >= 4.5,
      route + " dark navigation contrast: " + contrast,
    );
    await page.screenshot({
      path: path.join(
        output,
        (route.split("/").at(-1) || "overview") + "-dark.png",
      ),
      fullPage: true,
    });
    await page.select("#web-appearance", "light");
  }
  checks.push(
    "six routes: one main landmark and page title, 390/768/1440px without overflow, light and dark screenshots",
  );
  await page.goto(origin + "/app/account", { waitUntil: "networkidle0" });
  assert.equal(
    await page.$eval("[aria-current=page]", (el) => el.textContent),
    "Settings",
  );
  await page.select("select[name=theme]", "dark");
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/preferences") &&
      response.request().method() === "PUT",
  );
  await click("Save synced preferences");
  await saved;
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")].some(
        (b) => b.textContent?.includes("Save synced preferences") && b.disabled,
      ),
  );
  assert.equal(preferenceSaves, 1);
  assert.equal(
    await page.evaluate(() =>
      document.documentElement.classList.contains("light"),
    ),
    true,
  );
  checks.push(
    "account alias navigation and extension theme save remain independent of website appearance",
  );
  await page.select("#web-appearance", "dark");
  await page.reload({ waitUntil: "networkidle0" });
  assert.equal(
    await page.$eval(
      "#web-appearance",
      (el) => (el as HTMLSelectElement).value,
    ),
    "dark",
  );
  await page.select("#web-appearance", "system");
  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: "light" },
  ]);
  await page.waitForFunction(() =>
    document.documentElement.classList.contains("light"),
  );
  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: "dark" },
  ]);
  await page.waitForFunction(() =>
    document.documentElement.classList.contains("dark"),
  );
  checks.push("appearance persists and system changes apply");
  await page.goto(origin + "/app/playground", { waitUntil: "networkidle0" });
  assert.equal(
    await page.$$eval(
      "button",
      (nodes) => nodes.filter((n) => n.textContent === "Create run").length,
    ),
    12,
  );
  await click("Read-only practice");
  assert.equal(
    await page.$$eval(
      "button",
      (nodes) => nodes.filter((n) => n.textContent === "Create run").length,
    ),
    3,
  );
  await click("All tasks");
  await click("Create run");
  await page.waitForFunction(() =>
    document.body.textContent?.includes("Open application"),
  );
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "your-runs",
  );
  checks.push("catalog filters and creation guide focus to the new run");
  await page.setViewport({ width: 390, height: 844 });
  await click("Menu");
  const nav = await page.$eval("#app-navigation", (el) => ({
    width: el.getBoundingClientRect().width,
    labels: el.textContent,
  }));
  assert.ok(
    nav.width <= 390 &&
      nav.labels?.includes("Settings") &&
      nav.labels.includes("Sessions"),
  );
  await page.screenshot({
    path: path.join(output, "mobile-navigation.png"),
    fullPage: false,
  });
  await click("Close menu");
  await page.screenshot({
    path: path.join(output, "mobile-playground.png"),
    fullPage: false,
  });
  checks.push("mobile menu exposes all destinations");
  await page.goto(origin + "/app", { waitUntil: "networkidle0" });
  await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(() => document.activeElement?.textContent),
    "Skip to content",
  );
  await page.keyboard.press("Enter");
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "main-content",
  );
  checks.push("keyboard skip link moves focus to main content");
  signedIn = false;
  await page.goto(origin + "/app/playground", { waitUntil: "networkidle0" });
  await page.waitForFunction(() =>
    document.body.textContent?.includes("Sign in to create"),
  );
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, "browser-checks.json"),
    JSON.stringify({ passed: true, checks }, null, 2),
  );
  console.log("App UI checks passed:", checks.length);
} catch (error) {
  console.error(error);
  console.error("Page errors:", errors);
  throw error;
} finally {
  server.closeAllConnections();
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
