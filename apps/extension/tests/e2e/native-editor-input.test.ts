import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createE2EHarness } from "./helpers/harness";
import { getFixtureUrl } from "./helpers/fixture-server";
import { installLocalMockProviderInterceptor,
  localMockProviderScenarios } from "./helpers/local-mock-provider";
import { getActiveTabId, navigateAndWait, sendUserChat,
  waitForTaskCompletion } from "./helpers/utils";

const mockEnabled = process.env.E2E_LOCAL_MOCK_PROVIDER === "1";
if (mockEnabled) {
  process.env.E2E_PROVIDER = "fireworks";
  process.env.FIREWORKS_API_KEY ||= "local-mock";
}
const h = createE2EHarness({ testLabel: "native-editor" });

describe("E2E: native editor input", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  afterAll(() => h.afterAllHook());

  it.skipIf(!mockEnabled)("inserts text after a trusted click into a canvas-style editor", async () => {
    await h.beforeEachHook();
    const cdp = await h.ctx.serviceWorkerTarget.createCDPSession();
    try {
      await installLocalMockProviderInterceptor(cdp, "native-editor");
      await navigateAndWait(h.page, getFixtureUrl("summarize"));
      await h.page.evaluate(() => {
        const surface = document.createElement("div");
        surface.setAttribute("role", "textbox");
        surface.setAttribute("aria-label", "Document content");
        surface.setAttribute("tabindex", "0");
        surface.textContent = "Document content";
        surface.style.cssText = "width:500px;height:200px;border:2px solid black;margin:20px";
        const input = document.createElement("textarea");
        input.id = "native-editor-input";
        input.style.cssText = "position:fixed;left:-2000px;top:-2000px";
        const status = document.createElement("p");
        status.id = "native-editor-status";
        surface.addEventListener("click", (event) => {
          if (event.isTrusted) input.focus();
        });
        input.addEventListener("input", () => {
          status.textContent = `Document now contains: ${input.value}`;
        });
        document.body.prepend(surface, input, status);
      });
      const tabId = await getActiveTabId(h.ctx.serviceWorker);
      const scenario = localMockProviderScenarios["native-editor"];
      const workspaceId = await sendUserChat(h.ctx, scenario.prompt, tabId);
      const outcome = await waitForTaskCompletion(h.ctx, scenario.timeoutMs, workspaceId);
      const value = await h.page.$eval<HTMLTextAreaElement, string>(
        "#native-editor-input", (element) => element.value);
      expect(outcome.ok, `${outcome.reason}; editor value=${value}`).toBe(true);
      expect(value).toBe("Hello native editor");
      expect(await h.page.$eval("#native-editor-status", (element) => element.textContent))
        .toBe("Document now contains: Hello native editor");
    } finally {
      await cdp.detach().catch(() => undefined);
      await h.afterEachHook("native-editor");
    }
  }, 150_000);
});
