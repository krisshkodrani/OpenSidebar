import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Page } from "puppeteer";
import {
  closeExtension,
  launchWithExtension,
  type ExtensionContext,
} from "./helpers/browser";

describe("E2E: portable cloud restore production gate", () => {
  let ctx: ExtensionContext;
  let helper: Page;

  beforeAll(async () => {
    ctx = await launchWithExtension();
    helper = await ctx.browser.newPage();
    await helper.goto(`chrome-extension://${ctx.extensionId}/e2e-helper.html`);
  });

  afterAll(async () => {
    await helper?.close().catch(() => undefined);
    if (ctx) await closeExtension(ctx);
  });

  test("real service worker rejects list, prepare, and Continue without cloud or page effects", async () => {
    const target = await ctx.browser.newPage();
    await target.setContent("<button id='sentinel'>Untouched</button>");

    const results = await helper.evaluate(async (activeTabId: number) => {
      const send = async (type: string, payload: Record<string, unknown>) => {
        for (let attempt = 0; attempt < 20; attempt++) {
          const response = await new Promise((resolve) =>
            chrome.runtime.sendMessage(
              {
                type,
                requestId: crypto.randomUUID(),
                source: "sidepanel",
                payload,
              },
              resolve,
            ),
          );
          if (response !== undefined) return response;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return undefined;
      };
      return {
        manifest: chrome.runtime.getManifest().name,
        list: await send("CLOUD_RESTORE_LIST_REQUEST", {}),
        prepare: await send("CLOUD_RESTORE_PREPARE", {
          sessionId: crypto.randomUUID(),
          checkpointId: crypto.randomUUID(),
          tabId: activeTabId,
        }),
        continuation: await send("CLOUD_RESTORE_CONTINUE", {
          restoreId: crypto.randomUUID(),
        }),
        reconnect: await send("CLOUD_DEVICE_RECONNECT", {
          sessionId: crypto.randomUUID(),
          sessionRevision: 1,
          tabId: activeTabId,
        }),
        takeover: await send("CLOUD_DEVICE_TAKEOVER", {
          takeoverId: crypto.randomUUID(),
        }),
        takeoverContinue: await send("CLOUD_DEVICE_TAKEOVER_CONTINUE", {
          restoreId: crypto.randomUUID(),
        }),
      };
    }, 1);

    expect(results.manifest).toContain("OpenSidebar");
    expect(results.list).toMatchObject({ ok: false, disabled: true });
    expect(results.prepare).toMatchObject({ ok: false, disabled: true });
    expect(results.continuation).toMatchObject({ ok: false, disabled: true });
    expect(results.reconnect).toMatchObject({ ok: false, disabled: true });
    expect(results.takeover).toMatchObject({ ok: false, disabled: true });
    expect(results.takeoverContinue).toMatchObject({ ok: false, disabled: true });
    expect(await target.$eval("#sentinel", (node) => node.textContent)).toBe("Untouched");
    await target.close();
  });
});
