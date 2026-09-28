/** Exercise the built trace viewer against both Stage B1 read modes. */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import puppeteer from "puppeteer";
import { PROJECT_ROOT } from "./paths";
import { currentAnalyticsSnapshot } from "./analytics-snapshot";
import { readSessionEntries, SPAN_DIR } from "./span-store";

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 5_000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
  child.kill();
  await exited;
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function checkMode(mode: "spine" | "legacy" | "duckdb"): Promise<string> {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [
    join(PROJECT_ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
    join(PROJECT_ROOT, "scripts", "log-server.ts"),
  ], {
    cwd: PROJECT_ROOT, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, LOG_SERVER_PORT: String(port),
      LOG_SERVER_SKIP_TRACE_WARMUP: "1",
      OPENSIDEBAR_LOCAL_ALLOWED_ORIGINS: origin,
      OBS_DISABLE_SPINE_READS: mode === "legacy" ? "1" : "0",
      OBS_ANALYTICS: mode === "duckdb" ? "duckdb" : "0",
      OBS_ANALYTICS_SNAPSHOT: mode === "duckdb"
        ? currentAnalyticsSnapshot(PROJECT_ROOT, SPAN_DIR)?.dir : undefined },
  });
  let errors = "";
  child.stdout?.resume();
  child.stderr?.on("data", (chunk: Buffer) => {
    errors = (errors + chunk.toString()).slice(-2_000);
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) break;
      try {
        const response = await fetch(`${origin}/health`,
          { signal: AbortSignal.timeout(500) });
        if (response.ok) { ready = true; break; }
      } catch { /* wait for startup */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, `${mode} server did not start: ${errors}`);
    let sessionId = "";
    let firstTurn = 1;
    if (mode !== "duckdb") {
      const search = await fetch(`${origin}/api/traces/search?limit=50`,
        { signal: AbortSignal.timeout(60_000) });
      assert.equal(search.status, 200);
      const sessions = await search.json() as Array<{ sessionId?: string }>;
      const selected = sessions.find((session) => session.sessionId &&
        readSessionEntries(session.sessionId).length > 0);
      assert.ok(selected?.sessionId, `${mode}: no recent session with turns`);
      sessionId = selected.sessionId;
      const entries = readSessionEntries(sessionId);
      firstTurn = entries[0].turnNumber ?? 1;
      console.log(`[obs] ${mode}: selected ${sessionId} (${entries.length} turns)`);
    }
    const html = await (await fetch(`${origin}/viewer`)).text();
    const asset = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
    assert.ok(asset, `${mode}: viewer has no script asset`);
    const assetResponse = await fetch(`${origin}${asset}`,
      { signal: AbortSignal.timeout(15_000) });
    assert.equal(assetResponse.status, 200, `${mode}: viewer script asset failed`);
    await assetResponse.arrayBuffer();

    const browser = await puppeteer.launch({ headless: true,
      defaultViewport: { width: 1440, height: 900 },
      args: ["--no-proxy-server", "--disable-gpu"] });
    try {
      const page = await browser.newPage();
      const pageErrors: string[] = [];
      const apiResponses: string[] = [];
      const apiRequests: string[] = [];
      const assetResponses: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(String(error)));
      page.on("request", (request) => {
        if (request.url().includes("/api/")) apiRequests.push(request.url());
      });
      page.on("response", (response) => {
        if (response.url().includes("/api/"))
          apiResponses.push(`${response.status()} ${response.url()}`);
        if (response.url().includes("/assets/"))
          assetResponses.push(`${response.status()} ${response.url()}`);
        if (response.url().includes("/api/") && response.status() >= 400)
          pageErrors.push(`HTTP ${response.status()} ${response.url()}`);
      });
      page.on("requestfailed", (request) => {
        // React cancels the first detail fetch when its startup effects replay.
        if (request.failure()?.errorText === "net::ERR_ABORTED") return;
        pageErrors.push(`${request.failure()?.errorText} ${request.url()}`);
      });
      if (mode === "duckdb") {
        const analyticsStartedAt = Date.now();
        const analyticsResponse = page.waitForResponse((response) => {
          const url = new URL(response.url());
          return url.pathname === "/api/trace-insights" &&
            !url.searchParams.has("day");
        }, { timeout: 180_000 });
        await page.goto(`${origin}/viewer#top=analytics`,
          { waitUntil: "domcontentloaded", timeout: 30_000 });
        let response;
        try {
          response = await analyticsResponse;
        } catch (error) {
          const body = await page.evaluate(() => document.body.innerText.slice(0, 800));
          throw new Error(`DuckDB analytics response did not complete; body: ${body}; requests: ${apiRequests.join(" | ")}; responses: ${apiResponses.join(" | ")}; errors: ${pageErrors.join(" | ")}; server: ${errors}`, { cause: error });
        }
        assert.equal(response.status(), 200, "DuckDB analytics request failed");
        assert.equal(response.headers()["x-opensidebar-insights-source"], "duckdb");
        console.log(`[obs] duckdb browser insights: ${Date.now() - analyticsStartedAt}ms`);
        await page.waitForFunction(() => {
          const text = document.body.innerText;
          return text.includes("Est. cost") && !text.includes("Loading analytics...");
        }, { timeout: 30_000 });
        const visible = await page.evaluate(() => document.body.innerText);
        assert.ok(visible.includes("Traces"));
        assert.ok(!visible.includes("Failed to load analytics"));
        await page.waitForSelector(
          'svg[aria-label="Success rate and estimated cost per day"]',
          { timeout: 90_000 },
        );
        assert.deepEqual(pageErrors, [], "DuckDB analytics browser error");
        return sessionId;
      }
      const detailResponse = page.waitForResponse((response) =>
        response.url() === `${origin}/api/traces/${sessionId}`, { timeout: 45_000 });
      await page.goto(`${origin}/viewer#session=${sessionId}&view=turns`,
        { waitUntil: "domcontentloaded", timeout: 30_000 });
      console.log(`[obs] ${mode}: viewer loaded`);
      let detail;
      try {
        detail = await detailResponse;
      } catch (error) {
        const body = await page.evaluate(() => document.body.innerText.slice(0, 800));
        throw new Error(`${mode}: detail request did not complete; body: ${body}; API: ${apiResponses.join(" | ")}; assets: ${assetResponses.join(" | ")}; errors: ${pageErrors.join(" | ")}`, { cause: error });
      }
      console.log(`[obs] ${mode}: detail HTTP ${detail.status()}`);
      assert.equal(detail.status(), 200, `${mode}: viewer turn request failed`);
      try {
        await page.waitForSelector(`[aria-label="Focus turn ${firstTurn}"]`, { timeout: 30_000 });
      } catch (error) {
        const body = await page.evaluate(() => document.body.innerText.slice(0, 800));
        throw new Error(`${mode}: turn did not render: ${body}; page errors: ${pageErrors.join(" | ")}`, { cause: error });
      }
      const visible = await page.evaluate(() => document.body.innerText);
      assert.ok(visible.includes(`Turn ${firstTurn}`));
      assert.ok(!visible.includes("Failed to load turns"), `${mode}: ${visible.slice(0, 500)}`);
      assert.deepEqual(pageErrors, [], `${mode}: browser script error`);
      return sessionId;
    } finally {
      await browser.close();
    }
  } finally {
    await stop(child);
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--duckdb")) {
    assert.ok(currentAnalyticsSnapshot(PROJECT_ROOT, SPAN_DIR),
      "Build a current verified v5 snapshot before DuckDB browser acceptance.");
    await checkMode("duckdb");
    console.log("[obs] browser analytics acceptance passed with DuckDB.");
    return;
  }
  const spineSession = await checkMode("spine");
  const legacySession = await checkMode("legacy");
  assert.equal(legacySession, spineSession, "read modes selected different traces");
  console.log(`[obs] browser read acceptance passed in spine and legacy modes (${spineSession}, ${legacySession}).`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
