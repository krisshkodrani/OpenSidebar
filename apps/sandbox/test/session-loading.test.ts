import assert from "node:assert/strict";
import test from "node:test";
import { mkdir } from "node:fs/promises";
import { preview } from "vite";
import puppeteer from "puppeteer";

// Run against the built app: pnpm run sandbox:build && pnpm exec tsx --test apps/sandbox/test/session-loading.test.ts
// Delayed session responses expose even brief appearances of the login frame.
test("session checks never show login branding before authentication is known", async () => {
  const server = await preview({
    configFile: "apps/sandbox/vite.config.ts",
    preview: { port: 0 },
  });
  const browser = await puppeteer.launch({ headless: true });
  const base = server.resolvedUrls!.local[0];
  const page = await browser.newPage();
  let authenticated = true;
  let failure = false;
  let release: (() => void) | undefined;
  await page.setRequestInterception(true);
  page.on("request", async (request) => {
    const path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/")) {
      await request.continue();
      return;
    }
    if (path.endsWith("/auth/session")) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await request.respond({
        status: failure ? 503 : 200,
        contentType: "application/json",
        body: JSON.stringify(
          failure
            ? { error: { message: "Unavailable" } }
            : {
                authenticated,
                email: "test@example.com",
                csrfToken: "fixture",
              },
        ),
      });
      return;
    }
    await request.respond({
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: 1,
        accountId: "fixture",
        email: "test@example.com",
        traces: [],
      }),
    });
  });
  await page.evaluateOnNewDocument(() => {
    const seen: string[] = [];
    Object.assign(window, { seenSessionFrames: seen });
    new MutationObserver(() => {
      if (document.querySelector(".os-auth")) seen.push("login");
    }).observe(document, { childList: true, subtree: true });
  });
  const pending = async (path: string) => {
    console.log("Checking", path);
    release = undefined;
    await page.goto(new URL(path, base).href, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector(".os-session-frame");
    assert.equal(await page.$(".os-auth"), null);
    assert.equal(await page.$(".os-sidebar"), null);
    assert.equal(await page.title(), "Workspace · OpenSidebar");
    assert.ok(release, "session request is pending");
  };
  try {
    await pending("/app/missing-page");
    await mkdir(".artifacts/session-loading", { recursive: true });
    await page.screenshot({ path: ".artifacts/session-loading/desktop.png" });
    release!();
    await page.waitForSelector(".os-sidebar");
    assert.deepEqual(
      await page.evaluate(
        () =>
          (window as unknown as { seenSessionFrames: string[] })
            .seenSessionFrames,
      ),
      [],
    );

    // Follow a real internal link: its next document must use the neutral gate too.
    release = undefined;
    await page.click('a[href="/app/sessions"]');
    await page.waitForSelector(".os-session-frame");
    assert.equal(await page.$(".os-auth"), null);
    release!();
    await page.waitForSelector(".os-sidebar");
    assert.deepEqual(
      await page.evaluate(
        () =>
          (window as unknown as { seenSessionFrames: string[] })
            .seenSessionFrames,
      ),
      [],
    );

    await page.setViewport({ width: 390, height: 844 });
    await page.evaluate(() =>
      localStorage.setItem("opensidebar:workspace-appearance", "dark"),
    );
    await pending("/app/sign-in?return=%2Fapp%2Fsessions");
    await page.screenshot({
      path: ".artifacts/session-loading/mobile-dark.png",
    });
    release!();
    release = undefined;
    await page.waitForFunction(() => location.pathname === "/app/sessions");
    await page.waitForSelector(".os-session-frame");
    for (let i = 0; !release && i < 100; i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(release);
    release();
    await page.waitForSelector(".os-sidebar");
    assert.equal(await page.$(".os-auth"), null);

    failure = true;
    await pending("/app/missing-page");
    release!();
    await page.waitForSelector('[role="alert"]');
    assert.equal(await page.$(".os-auth"), null);
    assert.equal(await page.$(".os-sidebar"), null);
    failure = false;
    await page.click(".os-session-frame button");
    await page.waitForSelector('[role="status"]');
    release!();
    await page.waitForSelector(".os-sidebar");

    authenticated = false;
    await pending("/app/sign-in");
    release!();
    await page.waitForSelector(".os-signin-form");
    assert.equal(await page.$(".os-sidebar"), null);
  } catch (error) {
    console.error(error);
    throw error;
  } finally {
    await browser.close();
    server.httpServer.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.httpServer.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
