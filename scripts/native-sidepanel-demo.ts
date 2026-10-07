import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "puppeteer";
import type { ExtensionContext } from "../apps/extension/tests/e2e/helpers/browser";
import type { RuntimeMessage } from "../packages/shared-types/src/messages";

/** Read-only demonstration through the actual native side-panel composer. */
export async function runNativePanelDemo(
  ctx: ExtensionContext,
  fixture: Page,
  outputDir: string,
) {
  const originalUrl = fixture.url();
  const originalText = await fixture.evaluate(() => document.body.innerText);
  const target = await ctx.browser.waitForTarget(
    (candidate) =>
      candidate.url() ===
      `chrome-extension://${ctx.extensionId}/src/sidepanel/index.html`,
    { timeout: 15_000 },
  );
  const panel = await target.asPage();
  await panel.setViewport({ width: 440, height: 1100, deviceScaleFactor: 1 });
  await panel.evaluate(() => {
    const events: unknown[] = [];
    Object.assign(window, { __nativeDemoEvents: events });
    chrome.runtime.onMessage.addListener((message) => {
      if (["TASK_COMPLETION", "USER_CHAT_ACCEPTED"].includes(message.type)) {
        events.push(message);
      }
    });
  });

  const prompt =
    "Summarize this page in three short bullets. Do not modify the page.";
  await panel.waitForSelector("textarea", { visible: true, timeout: 15_000 });
  await panel.type("textarea", prompt);
  await panel.click('button[aria-label="Send message"]');
  try {
    await panel.waitForFunction(
      () => {
        const events = (
          window as unknown as { __nativeDemoEvents: RuntimeMessage[] }
        ).__nativeDemoEvents;
        return events.some((event) => event.type === "TASK_COMPLETION");
      },
      { timeout: 120_000, polling: 250 },
    );
  } catch (error) {
    writeFileSync(
      resolve(outputDir, "native-demo-events.json"),
      JSON.stringify(
        await panel.evaluate(
          () =>
            (window as unknown as { __nativeDemoEvents: unknown[] })
              .__nativeDemoEvents,
        ),
        null,
        2,
      ),
    );
    writeFileSync(
      resolve(outputDir, "native-demo-failure.txt"),
      await panel.evaluate(() => document.body.innerText),
    );
    await panel.screenshot({
      path: resolve(outputDir, "native-demo-failure.png"),
      fullPage: true,
    });
    throw error;
  }
  const events = await panel.evaluate(
    () =>
      (window as unknown as { __nativeDemoEvents: RuntimeMessage[] })
        .__nativeDemoEvents,
  );
  const completion = events.find((event) => event.type === "TASK_COMPLETION");
  assert.ok(completion?.type === "TASK_COMPLETION");
  const accepted = events.find((event) => event.type === "USER_CHAT_ACCEPTED");
  assert.ok(accepted?.type === "USER_CHAT_ACCEPTED");
  assert.equal(accepted.payload.text, prompt);
  assert.equal(completion.workspaceId, accepted.payload.workspaceId);
  assert.equal(
    completion.payload.status,
    "completed",
    completion.payload.summary,
  );
  assert.match(completion.payload.summary, /attention/i);
  assert.match(
    completion.payload.summary,
    /encoder|decoder|position|parallel/i,
  );
  assert.equal(fixture.url(), originalUrl);
  assert.equal(
    await fixture.evaluate(() => document.body.innerText),
    originalText,
  );
  await panel.waitForFunction(
    () => document.body.innerText.toLowerCase().includes("attention"),
    { timeout: 10_000 },
  );
  await panel.waitForFunction(
    () => document.querySelector("textarea")?.value === "",
    { timeout: 10_000, polling: 100 },
  );
  const screenshotPath = resolve(outputDir, "native-summary.png");
  await panel.screenshot({ path: screenshotPath, fullPage: true });
  return {
    prompt,
    status: completion.payload.status,
    summary: completion.payload.summary,
    totalTurnsUsed: completion.payload.totalTurnsUsed,
    metrics: completion.payload.metrics,
    unchangedPage: true,
    screenshotPath,
    modelSource: "live OpenRouter; local synthetic article",
  };
}
