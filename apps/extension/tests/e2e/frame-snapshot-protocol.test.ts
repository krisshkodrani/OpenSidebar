import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createE2EHarness } from "./helpers/harness";
import { getFixtureUrl } from "./helpers/fixture-server";
import { getActiveTabId, navigateAndWait, sendUserChat,
  waitForTaskCompletion } from "./helpers/utils";
import { installLocalMockProviderInterceptor,
  localMockProviderScenarios } from "./helpers/local-mock-provider";

const mockEnabled = process.env.E2E_LOCAL_MOCK_PROVIDER === "1";
if (mockEnabled) {
  process.env.E2E_PROVIDER = "fireworks";
  process.env.FIREWORKS_API_KEY ||= "local-mock";
}

const h = createE2EHarness({ testLabel: "frame-snapshot-protocol" });
let childServer: http.Server;
let childUrl: string;

describe("E2E: child-frame snapshot protocol", () => {
  beforeAll(async () => {
    childServer = http.createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(`<!doctype html><title>Checkout frame</title>
        <button onclick="this.textContent='Checkout continued'">Continue checkout</button>
        <input placeholder="Promo code" onkeydown="if(event.key==='Enter')document.getElementById('promo-status').textContent='Code applied'">
        <span id="promo-status"></span>`);
    });
    await new Promise<void>((resolve) => childServer.listen(0, "127.0.0.1", resolve));
    const address = childServer.address();
    if (!address || typeof address === "string") throw new Error("No child origin");
    childUrl = `http://127.0.0.1:${address.port}/checkout`;
    await h.beforeAllHook();
  }, 60_000);

  afterAll(async () => {
    await h.afterAllHook();
    if (childServer) await new Promise<void>((resolve) => childServer.close(() => resolve()));
  });

  it("reads a cross-origin child only through its targeted frame message", async () => {
    await navigateAndWait(h.page, getFixtureUrl("summarize"));
    await h.page.evaluate((url) => {
      const iframe = document.createElement("iframe");
      iframe.setAttribute("title", "Checkout frame");
      iframe.src = url;
      iframe.style.width = "400px";
      iframe.style.height = "200px";
      document.body.append(iframe);
    }, childUrl);
    const childFrame = await h.page.waitForFrame((frame) => frame.url() === childUrl);
    await childFrame.waitForSelector("button");
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    const result = await h.ctx.serviceWorker.evaluate(async ({ tabId, childUrl }) => {
      const chromeApi = (globalThis as typeof globalThis & { chrome: typeof chrome }).chrome;
      const frames = await chromeApi.webNavigation.getAllFrames({ tabId });
      const child = frames?.find((frame) => frame.url === childUrl);
      if (!child) throw new Error("Child frame not registered");
      const geometryNonce = crypto.randomUUID();
      const geometry = new Promise<{ rect: { width: number; height: number }; visible: boolean }>(
        (resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("No frame geometry report")), 5_000);
          chromeApi.runtime.onMessage.addListener((message: {
            type?: string; payload?: { nonce?: string; rect: { width: number; height: number };
              visible: boolean } }, sender) => {
            if (message.type !== "FRAME_GEOMETRY_REPORT" ||
                message.payload?.nonce !== geometryNonce || sender.frameId !== 0) return false;
            clearTimeout(timer);
            resolve(message.payload);
            return false;
          });
        });
      let lastError = "";
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          const response = await chromeApi.tabs.sendMessage(tabId, {
            type: "FRAME_SNAPSHOT_REQUEST",
            requestId: crypto.randomUUID(),
            source: "background",
            payload: { refresh: true, geometryNonce },
          }, { frameId: child.frameId });
          const frameGeometry = await geometry;
          const button = response.payload.snapshot.elements.find(
            (element: { text: string }) => element.text.includes("Continue checkout"));
          if (!button) throw new Error("Checkout button not in child snapshot");
          const action = await chromeApi.tabs.sendMessage(tabId, {
            type: "FRAME_TOOL_EXECUTE",
            requestId: crypto.randomUUID(),
            source: "background",
            payload: {
              toolName: "click_element", args: { id: button.tag },
              toolCallId: "frame-checkout-click",
              observationBasis: { ...response.payload.documentState,
                observationRevision: 0 },
            },
          }, { frameId: child.frameId });
          const staleAction = await chromeApi.tabs.sendMessage(tabId, {
            type: "FRAME_TOOL_EXECUTE",
            requestId: crypto.randomUUID(),
            source: "background",
            payload: {
              toolName: "click_element", args: { id: button.tag },
              toolCallId: "frame-stale-click",
              observationBasis: { ...response.payload.documentState,
                documentInstanceId: "stale-instance", observationRevision: 0 },
            },
          }, { frameId: child.frameId });
          return { response, geometry: frameGeometry, action, staleAction };
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      const probe = await chromeApi.scripting.executeScript({
        target: { tabId, frameIds: [child.frameId] },
        func: () => ({ url: location.href, isTop: window.top === window,
          extensionId: chrome.runtime.id }),
      });
      throw new Error(JSON.stringify({ lastError, frameId: child.frameId,
        probe: probe[0]?.result }));
    }, { tabId, childUrl });
    expect(result.response.type).toBe("FRAME_SNAPSHOT_RESPONSE");
    expect(result.response.payload.snapshot.url).toBe(childUrl);
    expect(result.response.payload.snapshot.elements.some((element: { text: string }) =>
      element.text.includes("Continue checkout"))).toBe(true);
    expect(result.geometry).toMatchObject({
      rect: { width: 400, height: 200 }, visible: true,
    });
    expect(result.action.payload.success).toBe(true);
    await childFrame.waitForFunction(() =>
      document.querySelector("button")?.textContent === "Checkout continued");
    expect(result.staleAction.payload.errorCode).toBe("stale_observation");
  }, 30_000);

  it.skipIf(!mockEnabled)("completes checkout with a routed child tag", async () => {
    await h.beforeEachHook();
    const cdp = await h.ctx.serviceWorkerTarget.createCDPSession();
    try {
      await installLocalMockProviderInterceptor(cdp, "iframe-checkout");
      await navigateAndWait(h.page, getFixtureUrl("summarize"));
      await h.page.evaluate((url) => {
        const iframe = document.createElement("iframe");
        iframe.src = url;
        iframe.style.width = "400px";
        iframe.style.height = "200px";
        document.body.append(iframe);
      }, childUrl);
      const childFrame = await h.page.waitForFrame((frame) => frame.url() === childUrl);
      await childFrame.waitForSelector("button");
      const tabId = await getActiveTabId(h.ctx.serviceWorker);
      const scenario = localMockProviderScenarios["iframe-checkout"];
      const workspaceId = await sendUserChat(h.ctx, scenario.prompt, tabId);
      const outcome = await waitForTaskCompletion(h.ctx, scenario.timeoutMs, workspaceId);
      expect(outcome.ok, outcome.reason).toBe(true);
      await childFrame.waitForFunction(() =>
        document.querySelector("button")?.textContent === "Checkout continued");
    } finally {
      await cdp.detach().catch(() => {});
      await h.afterEachHook("iframe-checkout");
    }
  }, 150_000);

  it.skipIf(!mockEnabled)("finds a child control and clicks its returned tag", async () => {
    await h.beforeEachHook();
    const cdp = await h.ctx.serviceWorkerTarget.createCDPSession();
    const requests: string[] = [];
    try {
      await installLocalMockProviderInterceptor(cdp, "iframe-find",
        (body) => requests.push(body));
      await navigateAndWait(h.page, getFixtureUrl("summarize"));
      await h.page.evaluate((url) => {
        const iframe = document.createElement("iframe");
        iframe.src = url;
        iframe.style.width = "400px";
        iframe.style.height = "200px";
        document.body.append(iframe);
      }, childUrl);
      const childFrame = await h.page.waitForFrame((frame) => frame.url() === childUrl);
      await childFrame.waitForSelector("button");
      const tabId = await getActiveTabId(h.ctx.serviceWorker);
      const scenario = localMockProviderScenarios["iframe-find"];
      const workspaceId = await sendUserChat(h.ctx, scenario.prompt, tabId);
      const outcome = await waitForTaskCompletion(h.ctx, scenario.timeoutMs, workspaceId);
      expect(outcome.ok, `${outcome.reason}; found=${requests.some((body) =>
        body.includes('Found \\"Continue checkout'))}; find excerpt=${requests
          .map((body) => /Found.{0,180}/.exec(body)?.[0]).find(Boolean)}`).toBe(true);
      await childFrame.waitForFunction(() =>
        document.querySelector("button")?.textContent === "Checkout continued");
    } finally {
      await cdp.detach().catch(() => {});
      await h.afterEachHook("iframe-find");
    }
  }, 150_000);

  it.skipIf(!mockEnabled)("reports a child without a content script as partial", async () => {
    await h.beforeEachHook();
    const cdp = await h.ctx.serviceWorkerTarget.createCDPSession();
    const requests: string[] = [];
    try {
      await installLocalMockProviderInterceptor(cdp,
        "done-summary-incomplete-recovery", (body) => requests.push(body));
      await navigateAndWait(h.page, getFixtureUrl("summarize"));
      await h.page.evaluate(() => {
        const iframe = document.createElement("iframe");
        iframe.src = `data:text/html,${encodeURIComponent("<button>Unreachable child</button>")}`;
        iframe.style.width = "300px";
        iframe.style.height = "100px";
        document.body.append(iframe);
      });
      await h.page.waitForFrame((frame) => frame.url().startsWith("data:text/html"));
      const tabId = await getActiveTabId(h.ctx.serviceWorker);
      const frames = await h.ctx.serviceWorker.evaluate((id) =>
        chrome.webNavigation.getAllFrames({ tabId: id }), tabId);
      expect(frames?.some((frame) => frame.url.startsWith("data:text/html"))).toBe(true);
      const scenario = localMockProviderScenarios["done-summary-incomplete-recovery"];
      const workspaceId = await sendUserChat(h.ctx, scenario.prompt, tabId);
      const outcome = await waitForTaskCompletion(h.ctx, scenario.timeoutMs, workspaceId);
      expect(outcome.ok, outcome.reason).toBe(true);
      expect(requests.some((body) => body.includes(
        "Content in 1 embedded frame(s) is temporarily unavailable."))).toBe(true);
    } finally {
      await cdp.detach().catch(() => {});
      await h.afterEachHook("iframe-partial-snapshot");
    }
  }, 150_000);

  it.skipIf(!mockEnabled)("presses Enter in the last interacted child frame", async () => {
    await h.beforeEachHook();
    const cdp = await h.ctx.serviceWorkerTarget.createCDPSession();
    const requests: string[] = [];
    try {
      await installLocalMockProviderInterceptor(cdp, "iframe-keyboard",
        (body) => requests.push(body));
      await navigateAndWait(h.page, getFixtureUrl("summarize"));
      await h.page.evaluate((url) => {
        const iframe = document.createElement("iframe");
        iframe.src = url;
        iframe.style.width = "400px";
        iframe.style.height = "200px";
        document.body.append(iframe);
      }, childUrl);
      const childFrame = await h.page.waitForFrame((frame) => frame.url() === childUrl);
      await childFrame.waitForSelector("input[placeholder='Promo code']");
      const tabId = await getActiveTabId(h.ctx.serviceWorker);
      const scenario = localMockProviderScenarios["iframe-keyboard"];
      const workspaceId = await sendUserChat(h.ctx, scenario.prompt, tabId);
      const outcome = await waitForTaskCompletion(h.ctx, scenario.timeoutMs, workspaceId);
      const status = await childFrame.$eval("#promo-status", (element) => element.textContent);
      expect(outcome.ok, `${outcome.reason}; observed status=${status}; model saw status=${
        requests.some((body) => body.includes("Code applied"))}`).toBe(true);
      expect(await childFrame.$eval("#promo-status", (element) => element.textContent))
        .toBe("Code applied");
    } finally {
      await cdp.detach().catch(() => {});
      await h.afterEachHook("iframe-keyboard");
    }
  }, 150_000);
});
