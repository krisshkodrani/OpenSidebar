/**
 * E2E Showcase: fill a LIVE job application (fill-only, never submit).
 *
 * A generalization of showcase-ashby-application.test.ts for a real posting.
 * Everything identifying — form URL, prompt, expected values — is read at
 * runtime from a kit directory OUTSIDE the repo tree (gitignored), pointed to
 * by E2E_LIVE_APP_KIT. Without that env var the suite skips, so this can never
 * fire in CI or staged runs, and this file contains no personal data.
 *
 * Run (PowerShell, repo root; E2E_PROFILE=video records frames for the demo):
 *   $env:E2E_LIVE_APP_KIT = "<kit dir containing run-config.json>"
 *   $env:E2E_PROFILE = "video"
 *   pnpm exec vitest run --config apps/extension/tests/e2e/vitest.e2e.config.ts `
 *     apps/extension/tests/e2e/showcase-live-application.test.ts
 *
 * Safety: the prompt forbids submitting, the completion criteria require the
 * confirmation text to be ABSENT, and job-application submits are hard-gated
 * behind an approval no one is present to grant. The form receives nothing
 * until submit, so failed takes are repeatable.
 */

import { type Server } from "http";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { createE2EHarness } from "./helpers/harness";
import {
  loadKitConfig,
  resolveLiveAppKitDir,
  serveKitFiles,
} from "./helpers/seed";
import {
  assertNoGhostSession,
  getActiveTabId,
  navigateAndWait,
  sendUserChat,
  waitForOutcome,
} from "./helpers/utils";

// The kit dir is resolved from E2E_LIVE_APP_KIT, else the default seed location
// (~/.opensidebar/seed/... via OPENSIDEBAR_SEED_DIR). Real PII lives there,
// outside the repo tree (pi-backend Phase 0).
const config = loadKitConfig(resolveLiveAppKitDir());
const h = createE2EHarness({
  maxTurns: config?.maxTurns ?? 30,
  testLabel: "showcase-live-application",
});

describe.skipIf(!config || !h.apiKey)("E2E Showcase: live job application", () => {
  let passed = false;
  let cvServer: Server | null = null;

  beforeAll(async () => {
    await h.beforeAllHook();
    if (config?.cvServe) {
      cvServer = await serveKitFiles(config.cvServe.dir, config.cvServe.port);
    }
  }, 180_000);
  beforeEach(async () => {
    passed = false;
    await h.beforeEachHook();
  });
  afterEach(() => h.afterEachHook("showcase-live-application", passed));
  afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (!cvServer) return resolve();
      cvServer.close(() => resolve());
    });
    await h.afterAllHook();
  });

  it("fills every listed field on the live form and never submits", async () => {
    const cfg = config!;
    await navigateAndWait(h.page, cfg.formUrl);
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const workspaceId = await sendUserChat(
      h.ctx,
      cfg.promptLines.join("\n"),
      tabId,
      null,
      { panelPromptEntry: "visible", typingDelayMs: 10 },
    );

    const checkArgs = {
      exact: cfg.expectedFieldValues,
      long: cfg.expectedLongTexts,
      pageText: cfg.expectedPageText,
      forbidden: cfg.forbiddenPageText,
    };

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () =>
        (await h.page.evaluate((args) => {
          const squash = (s: string) => s.replace(/\s+/g, " ").trim();
          const values: string[] = [];
          for (const el of Array.from(
            document.querySelectorAll<HTMLInputElement>("input"),
          )) {
            values.push(el.value);
          }
          for (const el of Array.from(
            document.querySelectorAll<HTMLTextAreaElement>("textarea"),
          )) {
            values.push(el.value);
          }
          for (const el of Array.from(
            document.querySelectorAll<HTMLSelectElement>("select"),
          )) {
            const opt = el.selectedOptions[0];
            if (opt) values.push(opt.textContent ?? "");
          }
          const body = document.body.innerText;
          const squashedValues = values.map(squash);
          const squashedBody = squash(body);

          if (args.forbidden.some((f) => squashedBody.includes(squash(f)))) {
            // Submission evidence on screen: fail closed by never matching.
            return null;
          }
          const exactOk = args.exact.every((v) => values.includes(v));
          // Long answers + dropdown choices may live in values or (for
          // custom combobox widgets) only in visible text.
          const longOk = args.long.every((v) => {
            const want = squash(v);
            return (
              squashedValues.some((have) => have === want) ||
              squashedBody.includes(want)
            );
          });
          const pageTextOk = args.pageText.every((t) =>
            squashedBody.includes(squash(t)),
          );
          if (!exactOk || !longOk || !pageTextOk) return null;
          return { exactOk, longOk, pageTextOk };
        }, checkArgs)) || null,
      480_000,
      workspaceId,
    );

    const { traceFiles } = await h.printTraceSummary(workspaceId);
    expect(traceFiles.length).toBeGreaterThan(0);
    expect(outcome.ok, outcome.reason).toBe(true);

    // Belt over braces: the not-submitted guard, asserted directly at the end.
    const bodyText = await h.page.evaluate(() => document.body.innerText);
    for (const forbidden of config!.forbiddenPageText) {
      expect(bodyText).not.toContain(forbidden);
    }

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
    passed = true;
  }, 600_000);
});
