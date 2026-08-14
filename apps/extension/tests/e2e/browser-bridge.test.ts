/**
 * E2E: the browser bridge completes a task in a real browser (RFC LP-8, M2).
 *
 * This is the test that did not exist while the bridge was broken, and its
 * absence is why "M2 COMPLETE end-to-end" was believed for months. The bridge
 * had NEVER completed a task in a real Chrome: `chrome.runtime.sendMessage` does
 * not deliver back to the sending context, so the orchestrator's TASK_COMPLETION
 * — broadcast from the service worker — never reached `createAgentRuntime`,
 * which subscribes in that same service worker. Every thick tool call hung until
 * the host's transport timeout.
 *
 * Everything that mattered was mocked: the one seam test used a fake port whose
 * `deliver()` supplied the loopback by fiat, and `browser_ping` short-circuits
 * before starting a task, so a smoke test passed over a dead path. So this test
 * insists on the real things — real Chrome, real service worker, real
 * orchestrator, real WebSocket host, real completion message. Only the LLM is
 * mocked, via the CDP interceptor, and the LLM was never what broke.
 *
 * Run it against `main` and it fails with "browser tool call timed out" after
 * the host's full timeout. That A/B is the proof; the assertion below names that
 * string deliberately so the failure reads as the original bug, not as flake.
 *
 * It covers both Phase 1 commits at once, which is why this scenario was chosen:
 *   - `f3c2a3e3` — a completion arrives at all (the port self-delivers).
 *   - `69010ed8` — `partial` maps to `needs_human` rather than `error`, and the
 *     PartialProgressHandoff survives instead of being discarded.
 *
 * No API key: the local mock provider answers as a scripted LLM, so this runs
 * offline like the rest of the `E2E_LOCAL_MOCK_PROVIDER` suite.
 */

import type { CDPSession, WebWorker } from "puppeteer";
import { describe, expect, test } from "vitest";

import { WebSocketBridge } from "../../../../scripts/browser-mcp/ws-bridge";
import {
  E2E_CREATE_WORKSPACE_MESSAGE_TYPE,
  E2E_TEST_API_ENABLED_STORAGE_KEY,
} from "../../src/background/e2e-test-api";
import { getFixtureUrl } from "./helpers/fixture-server";
import { createE2EHarness } from "./helpers/harness";
import { openHelperPage } from "./helpers/browser";
import {
  installLocalMockProviderInterceptor,
  localMockProviderScenarios,
} from "./helpers/local-mock-provider";

const enabled = process.env.E2E_LOCAL_MOCK_PROVIDER === "1";

if (enabled) {
  process.env.E2E_PROVIDER = "fireworks";
  process.env.FIREWORKS_API_KEY = process.env.FIREWORKS_API_KEY || "local-mock";
}

/** Must match `background/browser-bridge/index.ts`. */
const BROWSER_MCP_WS_PORT_KEY = "opensidebar:browserMcpWsPort";

/** The service worker only reads the port at startup, so it must be set first. */
async function armBridgePort(
  serviceWorker: WebWorker,
  port: number,
): Promise<void> {
  await serviceWorker.evaluate(
    async (key: string, value: number) => {
      await chrome.storage.local.set({ [key]: value });
    },
    BROWSER_MCP_WS_PORT_KEY,
    port,
  );
}

async function waitForBridgeConnection(
  bridge: WebSocketBridge,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (bridge.connected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `extension did not connect to the bridge host within ${timeoutMs}ms — ` +
      `check that ${BROWSER_MCP_WS_PORT_KEY} was set before the reload`,
  );
}

describe.skipIf(!enabled)("E2E: browser bridge", () => {
  test("a thick tool call runs a real task and gets its completion back", async () => {
    // maxTurns: 2 against a read-only fixture, so the run cannot finish and must
    // produce a partial handoff — the artifact the bridge used to throw away.
    const scenario = localMockProviderScenarios["partial-handoff-max-turns"];
    const h = createE2EHarness({
      maxTurns: scenario.maxTurns,
      testLabel: "browser-bridge-run-task",
      videoStart: "manual",
    });

    let bridge: WebSocketBridge | null = null;
    let cdp: CDPSession | null = null;
    let passed = false;

    try {
      await h.beforeAllHook();
      await h.beforeEachHook();

      cdp = await h.ctx.serviceWorkerTarget.createCDPSession();
      await installLocalMockProviderInterceptor(cdp, "partial-handoff-max-turns");

      // Port 0 → the OS picks one, so concurrent e2e runs cannot collide on 8787.
      bridge = await WebSocketBridge.create({ port: 0, timeoutMs: 120_000 });

      // Setting the key is all it takes: initBrowserBridge() watches
      // chrome.storage.onChanged and connects live — no extension reload.
      // (That listener exists because of this test: the startup-only read
      // made the bridge unstartable without a reload, for users too.)
      await armBridgePort(h.ctx.serviceWorker, bridge.port);
      await waitForBridgeConnection(bridge, 15_000);

      const sourceTabId = await h.ctx.serviceWorker.evaluate(async () => {
        const source = await chrome.tabs.create({ url: "about:blank", active: true });
        if (typeof source.id !== "number") throw new Error("No source tab for workspace");
        return source.id;
      });
      const helperPage = await openHelperPage(h.ctx);
      const workspaceId = "e2e-browser-bridge-workspace";
      const createResult = await helperPage.evaluate(
        async (input) => {
          await chrome.storage.local.set({ [input.enabledKey]: true });
          return chrome.runtime.sendMessage({
            type: input.messageType,
            payload: {
              tabId: input.tabId,
              workspaceId: input.workspaceId,
              name: "OpenSidebar E2E",
            },
          });
        },
        {
          enabledKey: E2E_TEST_API_ENABLED_STORAGE_KEY,
          messageType: E2E_CREATE_WORKSPACE_MESSAGE_TYPE,
          tabId: sourceTabId,
          workspaceId,
        },
      );
      expect(createResult).toMatchObject({ ok: true, workspaceId });

      // The task opens its own background tab at this url, so the test drives no
      // page itself — this is exactly the path pi will take.
      const targetUrl = getFixtureUrl(scenario.fixture);
      const response = await bridge.call({
        tool: "browser_run_task",
        args: {
          instruction: scenario.prompt,
          url: targetUrl,
        },
      });

      // The original failure, named so a regression reads as itself: the promise
      // never settled and the host's transport timeout was the only thing that
      // ever spoke. Assert it first — every other assertion is downstream of a
      // completion having arrived at all.
      expect(response.reason ?? "").not.toContain("browser tool call timed out");

      // `partial` is progress, not breakage.
      expect(response.status).toBe("needs_human");

      // The handoff is the whole point of the mission/report design: it is what
      // lets a caller continue rather than start over.
      expect(response.handoff).toBeDefined();
      expect(response.handoff?.schemaVersion).toBeTruthy();
      expect(response.handoff?.suggestedContinuationPrompt).toBeTruthy();
      expect(response.handoff?.remaining?.length ?? 0).toBeGreaterThan(0);

      const placement = await h.ctx.serviceWorker.evaluate(async (input) => {
        const { url, sourceTabId } = input;
        const expected = new URL(url).href;
        const matches = (await chrome.tabs.query({})).filter((tab) => {
          try {
            return Boolean(tab.url && new URL(tab.url).href === expected);
          } catch {
            return false;
          }
        });
        const source = await chrome.tabs.get(sourceTabId);
        const target = matches.find((tab) => tab.id !== sourceTabId);
        if (typeof target?.id !== "number") return { matches: matches.length };
        const panel = await chrome.sidePanel.getOptions({ tabId: target.id });
        const group = target.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE
          ? null
          : await chrome.tabGroups.get(target.groupId);
        return {
          matches: matches.length,
          sourceGroupId: source.groupId,
          targetGroupId: target.groupId,
          groupTitle: group?.title,
          panelEnabled: panel.enabled,
          panelPath: panel.path,
        };
      }, { url: targetUrl, sourceTabId });
      expect(placement).toMatchObject({
        matches: 1,
        panelEnabled: true,
        panelPath: "src/sidepanel/index.html",
      });
      expect(placement.groupTitle).toEqual(expect.any(String));
      expect(placement.targetGroupId).toBe(placement.sourceGroupId);

      passed = true;
    } finally {
      await bridge?.close();
      await h.afterEachHook("browser-bridge-run-task", passed);
      await h.afterAllHook();
    }
  }, 240_000);
});
