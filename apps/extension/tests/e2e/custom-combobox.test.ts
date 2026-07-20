/**
 * E2E: custom-select (react-select-style) comboboxes — select from portaled
 * option menus whose input CLEARS on commit.
 *
 * The exact widget shape that made the agent loop on real Greenhouse forms:
 * the committed value renders in a `.select__single-value` sibling (not
 * `input.value`), the menu portals to document.body, and no "Selected: X"
 * text appears. Passing requires the commit + verification fixes: combobox-
 * aware value reading, option-click commit echo, and the `select_option`
 * custom branch.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { createE2EHarness } from "./helpers/harness";
import {
  assertNoGhostSession,
  getActiveTabId,
  navigateAndWait,
  sendUserChat,
  waitForOutcome,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";

const h = createE2EHarness({ maxTurns: 20, testLabel: "custom-combobox" });

describe.skipIf(!h.apiKey)("E2E: Custom Combobox", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("custom-combobox"));
  afterAll(() => h.afterAllHook());

  it("agent commits selections in react-select-style dropdowns without looping", async () => {
    await navigateAndWait(h.page, getFixtureUrl("custom-combobox"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt =
      "Set the country to 'Austria' and the salary expectations to '€ 50,000 - 60,000' using the two dropdowns.";

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).customComboboxResult ?? null,
        );
        if (
          result &&
          result.country === "Austria" &&
          result.salary === "€ 50,000 - 60,000"
        )
          return result;
        return null;
      },
      240_000,
      workspaceId,
    );

    await h.printTraceSummary();

    if (!outcome.ok) {
      const ui = await h.page.evaluate(() => ({
        customComboboxResult: (window as any).customComboboxResult,
        singleValues: Array.from(
          document.querySelectorAll(".select__single-value"),
        ).map((n) => n.textContent),
      }));
      console.log(
        "[e2e] FAILURE DIAGNOSTICS:",
        JSON.stringify(
          { reason: outcome.reason, ui, events: outcome.events.slice(-10) },
          null,
          2,
        ),
      );
    }
    expect(outcome.ok, outcome.reason).toBe(true);

    const result = outcome.result as any;
    expect(result.country).toBe("Austria");
    expect(result.salary).toBe("€ 50,000 - 60,000");

    console.log(`\n[e2e] PASS — both custom-combobox selections committed`);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 320_000);
});
