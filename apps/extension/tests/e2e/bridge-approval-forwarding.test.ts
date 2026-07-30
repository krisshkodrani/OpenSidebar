/**
 * E2E: the browser bridge forwards a consequential-action approval to its caller
 * and resumes on the answer (pi-backend Phase 4, "grounded submit").
 *
 * A job-application form submit is hard-gated: the run pauses for approval and
 * forceApproval defeats bypassApprovals. A bridge mission has no sidepanel to
 * answer that pause — the live pi session proved it fails at tab-rebind. Phase 4
 * FORWARDS the pause: it arrives as `needs_human` carrying the approval question
 * AND the Phase 8 dry-run diff (the live form vs. the values the caller asked
 * for), so the caller — pi, or this test standing in for it — can byte-check the
 * form before it approves. The caller answers with `browser_respond_approval`,
 * which resumes the paused task and replays the exact gated submit.
 *
 * This is the only test that exercises the whole round trip in a real Chrome:
 * real service worker, real orchestrator, real WebSocket host, real pause +
 * checkpoint, real resume. Only the LLM is mocked (via the CDP interceptor), and
 * the LLM was never the part that gates.
 *
 * Two cases, because approval has two answers:
 *   - approved:true  → the submit replays, the form is submitted, the run ends ok.
 *   - approved:false → the submit is refused; the run never claims a submission.
 *
 * No API key: the local mock provider answers as a scripted LLM, so this runs
 * offline like the rest of the `E2E_LOCAL_MOCK_PROVIDER` suite.
 */

import type { CDPSession, WebWorker } from "puppeteer";
import { describe, expect, test } from "vitest";

import { WebSocketBridge } from "../../../../scripts/browser-mcp/ws-bridge";
import { getFixtureUrl } from "./helpers/fixture-server";
import { createE2EHarness } from "./helpers/harness";
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
const BROWSER_MCP_AUTH_TOKEN_KEY = "opensidebar:browserMcpAuthToken";
const BROWSER_MCP_AUTH_TOKEN =
  "e2e-browser-bridge-token-32-bytes-minimum";

/** The service worker only reads the port at startup, so it must be set first. */
async function armBridgePort(
  serviceWorker: WebWorker,
  port: number,
): Promise<void> {
  await serviceWorker.evaluate(
    async (portKey: string, tokenKey: string, value: number, token: string) => {
      await chrome.storage.local.set({
        [portKey]: value,
        [tokenKey]: token,
      });
    },
    BROWSER_MCP_WS_PORT_KEY,
    BROWSER_MCP_AUTH_TOKEN_KEY,
    port,
    BROWSER_MCP_AUTH_TOKEN,
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

const scenario = localMockProviderScenarios["bridge-approval-forwarding"];

/**
 * Drive the mission up to the forwarded pause and return the `browser_run_task`
 * response — shared by both cases, which only differ in how they answer.
 */
async function runToPause(
  bridge: WebSocketBridge,
): Promise<Awaited<ReturnType<WebSocketBridge["call"]>>> {
  return bridge.call({
    tool: "browser_run_task",
    args: {
      instruction: scenario.prompt,
      url: getFixtureUrl(scenario.fixture),
    },
  });
}

describe.skipIf(!enabled)("E2E: browser bridge — approval forwarding", () => {
  test("approving a forwarded submit resumes the task and submits", async () => {
    const h = createE2EHarness({
      maxTurns: scenario.maxTurns,
      testLabel: "bridge-approval-forwarding-approve",
      videoStart: "manual",
    });

    let bridge: WebSocketBridge | null = null;
    let cdp: CDPSession | null = null;
    let passed = false;

    try {
      await h.beforeAllHook();
      await h.beforeEachHook();

      cdp = await h.ctx.serviceWorkerTarget.createCDPSession();
      await installLocalMockProviderInterceptor(cdp, "bridge-approval-forwarding");

      bridge = await WebSocketBridge.create({
        port: 0,
        timeoutMs: 120_000,
        authToken: BROWSER_MCP_AUTH_TOKEN,
      });
      await armBridgePort(h.ctx.serviceWorker, bridge.port);
      await waitForBridgeConnection(bridge, 15_000);

      // The submit gates: the run pauses and the pause is forwarded, not dropped.
      const paused = await runToPause(bridge);

      expect(paused.reason ?? "").not.toContain("browser tool call timed out");
      expect(paused.status).toBe("needs_human");

      // The approval question rides the response — this is what pi presents.
      const approval = paused.approval;
      expect(approval).toBeDefined();
      expect(approval?.approvalId).toBeTruthy();
      expect(approval?.toolName).toBe("click_element");

      // The Phase 8 dry-run diff rides along so the caller can byte-check the
      // live form against the values it asked for before it approves. Every
      // field the caller supplied — text AND the terms checkbox — round-trips,
      // so a correctly-filled form reads fully "clean" (the pi-backend Phase 8
      // checkbox fix: the dry-run captures the control label + treats
      // checked == true). This is the grounded-submit contract pi relies on.
      const dryRun = approval?.dryRun;
      expect(dryRun).toBeDefined();
      expect(dryRun?.entries?.length ?? 0).toBeGreaterThan(0);
      expect(dryRun?.kind).toBe("clean");
      for (const entry of dryRun?.entries ?? []) {
        expect(typeof entry.label).toBe("string");
        expect(entry.status).toBe("match");
      }

      // Answer as pi would: approve. The paused task resumes and replays the
      // exact gated submit; the answer settles on the run's next outcome.
      const done = await bridge.call({
        tool: "browser_respond_approval",
        args: { approvalId: approval!.approvalId, approved: true },
      });

      expect(done.reason ?? "").not.toContain("browser tool call timed out");
      expect(done.status).toBe("ok");
      expect(String(done.result ?? "")).toMatch(/submitted/i);

      passed = true;
    } finally {
      await bridge?.close();
      await h.afterEachHook("bridge-approval-forwarding-approve", passed);
      await h.afterAllHook();
    }
  }, 300_000);

  test("denying a forwarded submit refuses it — no submission is claimed", async () => {
    const h = createE2EHarness({
      maxTurns: scenario.maxTurns,
      testLabel: "bridge-approval-forwarding-deny",
      videoStart: "manual",
    });

    let bridge: WebSocketBridge | null = null;
    let cdp: CDPSession | null = null;
    let passed = false;

    try {
      await h.beforeAllHook();
      await h.beforeEachHook();

      cdp = await h.ctx.serviceWorkerTarget.createCDPSession();
      await installLocalMockProviderInterceptor(cdp, "bridge-approval-forwarding");

      bridge = await WebSocketBridge.create({
        port: 0,
        timeoutMs: 120_000,
        authToken: BROWSER_MCP_AUTH_TOKEN,
      });
      await armBridgePort(h.ctx.serviceWorker, bridge.port);
      await waitForBridgeConnection(bridge, 15_000);

      const paused = await runToPause(bridge);
      expect(paused.status).toBe("needs_human");
      const approval = paused.approval;
      expect(approval?.approvalId).toBeTruthy();

      // Deny. The gated submit is refused; the run settles on a terminal outcome
      // that must never report the application as submitted.
      const denied = await bridge.call({
        tool: "browser_respond_approval",
        args: { approvalId: approval!.approvalId, approved: false },
      });

      expect(denied.reason ?? "").not.toContain("browser tool call timed out");
      // Whether the run ends (honest "not submitted") or re-asks (a fresh pause),
      // the one invariant is that nothing claims the submission went through.
      const text = String(denied.result ?? denied.reason ?? "");
      expect(text).not.toMatch(/registration received|successfully submitted/i);

      passed = true;
    } finally {
      await bridge?.close();
      await h.afterEachHook("bridge-approval-forwarding-deny", passed);
      await h.afterAllHook();
    }
  }, 300_000);
});
