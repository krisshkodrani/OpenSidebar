/**
 * E2E: Browser file upload from a page-provided fixture URL.
 *
 * Run: pnpm run test:e2e interaction-regression
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { randomUUID } from "crypto";
import { createE2EHarness } from "./helpers/harness";
import { ensureE2EPanel, openHelperPage } from "./helpers/browser";
import { traceFilesContainText } from "./helpers/diagnostics";
import {
  assertNoGhostSession,
  getActiveTabId,
  navigateAndWait,
  waitForOutcome,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";

const h = createE2EHarness({
  maxTurns: 10,
  testLabel: "file-transfer",
});

type FileTransferUpload = {
  filename: string;
  size: number;
  text: string;
};

async function sendDirectUserChat(prompt: string, tabId: number) {
  const workspaceId = `e2e-${randomUUID()}`;
  await ensureE2EPanel(h.ctx, tabId, workspaceId);
  const helperPage = await openHelperPage(h.ctx);
  await helperPage.evaluate(
    async (text: string, targetTabId: number, targetWorkspaceId: string) => {
      await chrome.runtime.sendMessage({
        type: "USER_CHAT",
        requestId: crypto.randomUUID(),
        source: "sidepanel",
        payload: {
          text,
          tabId: targetTabId,
          workspaceId: targetWorkspaceId,
          messageId: crypto.randomUUID(),
          timestamp: Date.now(),
        },
      });
    },
    prompt,
    tabId,
    workspaceId,
  );
  return workspaceId;
}

describe.skipIf(!h.apiKey)("E2E: File Transfer", () => {
  beforeAll(() => h.beforeAllHook(), 120_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("file-transfer"));
  afterAll(() => h.afterAllHook());

  it("uploads a page-provided CSV URL into a file input", async () => {
    await navigateAndWait(h.page, getFixtureUrl("file-transfer"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const sampleUrl = await h.page.evaluate(
      () => (window as any).fileTransferSampleUrl as string,
    );
    expect(sampleUrl).toMatch(/\/downloads\/vendor-catalog-sample\.csv$/);

    const prompt = [
      "Please upload the vendor catalog CSV from this page to the vendor import field.",
      `The file URL shown on the page is ${sampleUrl}.`,
    ].join(" ");
    const workspaceId = await sendDirectUserChat(prompt, tabId);

    const outcome = await waitForOutcome<FileTransferUpload>(
      h.page,
      h.ctx.serviceWorker,
      async () =>
        (await h.page.evaluate(
          () => (window as any).fileTransferUpload as FileTransferUpload | null,
        )) || null,
      180_000,
      workspaceId,
    );
    const { traceFiles } = await h.printTraceSummary(workspaceId);

    expect(outcome.ok, outcome.reason).toBe(true);
    expect(outcome.result).toMatchObject({
      filename: "vendor-catalog-sample.csv",
    });
    expect(outcome.result?.text).toContain("Acme Analytics");

    expect(traceFilesContainText(traceFiles, '"name":"upload_file"')).toBe(
      true,
    );
    expect(traceFiles.length).toBeGreaterThan(0);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 240_000);
});
