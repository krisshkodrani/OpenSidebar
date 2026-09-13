import { serve, type ServerType } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { BrowserCommandV1 } from "@shared-types/cloud-sessions";
import {
  closeExtension,
  launchWithExtension,
  openHelperPage,
  type ExtensionContext,
} from "./helpers/browser";

describe("E2E: bounded cloud write command", () => {
  let ctx: ExtensionContext;
  let server: ServerType;
  let pageUrl: string;

  beforeAll(async () => {
    server = serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response(
        "<!doctype html><label>Email <input aria-label='Email' type='email'></label><button aria-label='Show details' onclick=\"this.remove()\">Show details</button><main></main>",
        { headers: { "content-type": "text/html" } },
      ),
    });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server unavailable");
    pageUrl = `http://127.0.0.1:${address.port}/form`;
    ctx = await launchWithExtension();
  });

  afterAll(async () => {
    if (ctx) await closeExtension(ctx);
    if (server)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
  });

  test("semantically resolves, types, and verifies without Enter or submit", async () => {
    const target = await ctx.browser.newPage();
    await target.goto(pageUrl);
    const helper = await openHelperPage(ctx);
    await target.bringToFront();
    const tabId = await helper.evaluate(async (url) => {
      await chrome.storage.local.set({ "opensidebar:e2eTestApiEnabled": true });
      for (let attempt = 0; attempt < 50; attempt++) {
        const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))
          .find((item) => item.url === url);
        if (tab?.id != null) {
          try {
            const ready = await chrome.tabs.sendMessage(tab.id, {
              type: "E2E_CONTENT_READY_PING",
              requestId: crypto.randomUUID(),
              source: "sidepanel",
              payload: {},
            });
            if (ready?.ok) return tab.id;
          } catch {
            // The content script may still be starting.
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("content script did not become ready");
    }, pageUrl);
    const origin = new URL(pageUrl).origin;
    const now = new Date().toISOString();
    const command: BrowserCommandV1 = {
      schemaVersion: 1,
      sessionId: crypto.randomUUID(),
      commandId: crypto.randomUUID(),
      leaseId: crypto.randomUUID(),
      leaseGeneration: 1,
      checkpointRevision: 1,
      createdAt: now,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      action: {
        kind: "type_text",
        target: {
          description: "Email field",
          expectedRole: "email",
          expectedName: "Email",
          expectedOrigin: origin,
        },
        arguments: { text: "tester@example.test" },
      },
      preconditions: [
        { kind: "origin", value: origin },
        { kind: "fresh_observation", value: "required" },
        { kind: "semantic_target", value: "unique" },
      ],
      risk: "reversible_write",
    };

    const response = await helper.evaluate(
      (payload) => chrome.runtime.sendMessage({ type: "E2E_EXECUTE_CLOUD_COMMAND", payload }),
      { tabId, command },
    );
    expect(response).toEqual({ ok: true, outcome: "succeeded" });
    expect(await target.$eval("input", (element) => (element as HTMLInputElement).value))
      .toBe("tester@example.test");

    const click: BrowserCommandV1 = {
      ...command,
      commandId: crypto.randomUUID(),
      action: {
        kind: "click",
        target: {
          description: "Reveal details",
          expectedRole: "button",
          expectedName: "Show details",
          expectedOrigin: origin,
        },
        arguments: {
          postcondition: { kind: "target_absent" },
        },
      },
    };
    const paused = await helper.evaluate(
      (payload) => chrome.runtime.sendMessage({ type: "E2E_EXECUTE_CLOUD_COMMAND", payload }),
      { tabId, command: click },
    );
    expect(paused).toEqual({ ok: false, approvalRequired: true });
    expect(await target.$("button")).not.toBeNull();
    const clicked = await helper.evaluate(
      (payload) => chrome.runtime.sendMessage({ type: "E2E_EXECUTE_CLOUD_COMMAND", payload }),
      { tabId, command: click, locallyApproved: true },
    );
    expect(clicked).toEqual({ ok: true, outcome: "succeeded" });
    expect(await target.$("button")).toBeNull();
    await target.close();
  });
});
