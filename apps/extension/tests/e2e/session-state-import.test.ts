import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { getFixtureUrl } from "./helpers/fixture-server";
import { createE2EHarness } from "./helpers/harness";
import { importPlaywrightStorageState } from "./helpers/session-state";

const h = createE2EHarness({ testLabel: "session-state-import" });

describe("E2E: Session State Import", () => {
  beforeAll(() => h.beforeAllHook(), 120_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("session-state-import"));
  afterAll(() => h.afterAllHook());

  it("imports Playwright-style cookies and storage into the extension browser", async () => {
    const finalUrl = getFixtureUrl("session-state");
    const origin = new URL(finalUrl).origin;

    const result = await importPlaywrightStorageState(
      h.page,
      {
        cookies: [
          {
            name: "workarena_session",
            value: "fixture-session",
            domain: "127.0.0.1",
            path: "/",
            expires: -1,
            httpOnly: false,
            secure: false,
            sameSite: "Lax",
          },
        ],
        origins: [
          {
            origin,
            localStorage: [{ name: "workspace", value: "workarena-copy" }],
            sessionStorage: [{ name: "run_id", value: "local-rehearsal" }],
          },
        ],
      },
      { finalUrl },
    );

    expect(result).toEqual({
      cookies: 1,
      localStorage: 1,
      sessionStorage: 1,
      origins: [origin],
    });

    await h.page.waitForSelector('[data-testid="session-cookie"]');

    const importedState = await h.page.evaluate(() => ({
      cookie: document.querySelector('[data-testid="session-cookie"]')?.textContent,
      localStorage: document.querySelector('[data-testid="session-local-storage"]')
        ?.textContent,
      sessionStorage: document.querySelector('[data-testid="session-session-storage"]')
        ?.textContent,
    }));

    expect(importedState).toEqual({
      cookie: "fixture-session",
      localStorage: "workarena-copy",
      sessionStorage: "local-rehearsal",
    });
  }, 90_000);
});
