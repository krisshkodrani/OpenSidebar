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
  assertNoGhostSession,
  getActiveTabId,
  navigateAndWait,
  sendUserChat,
  waitForOutcome,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";
import { traceFilesContainText } from "./helpers/diagnostics";
import { waitForBackendHealthy } from "./helpers/backend";
import {
  seedTemporaryProfile,
  type SeededProfile,
} from "./helpers/profile";

const h = createE2EHarness({ maxTurns: 18, testLabel: "profile-checkout" });
const RUN_BACKEND_PROFILE_E2E = process.env.E2E_BACKEND_PROFILE === "true";

describe.skipIf(!h.apiKey || !RUN_BACKEND_PROFILE_E2E)(
  "E2E: Profile Checkout",
  () => {
    let seededProfile: SeededProfile | null = null;

    beforeAll(() => h.beforeAllHook(), 60_000);
    afterAll(() => h.afterAllHook());

    beforeEach(async () => {
      await h.beforeEachHook();
      expect(
        await waitForBackendHealthy(),
        "Backend must be running for the profile checkout smoke",
      ).toBe(true);

      seededProfile = await seedTemporaryProfile({
        profile: {
          identity: {
            first_name: "Kai",
            last_name: "Schmidt",
            email: "kai.profile@example.com",
          },
        },
      });
    });

    afterEach(async () => {
      if (seededProfile) {
        await seededProfile.restore();
        seededProfile = null;
      }
      await h.afterEachHook("profile-checkout");
    });

    it("uses saved profile fields to complete checkout", async () => {
      await navigateAndWait(h.page, getFixtureUrl("shop"));
      await h.page.bringToFront();
      const tabId = await getActiveTabId(h.ctx.serviceWorker);
      expect(tabId).toBeGreaterThan(0);

      const prompt =
        "Add the Air Zoom Pegasus 41 to cart, choose standard shipping, and use my saved profile for checkout. " +
        "My saved profile stores identity.first_name, identity.last_name, and identity.email. " +
        "Do not invent any checkout details if they are already in the profile.";

      const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

      const outcome = await waitForOutcome(
        h.page,
        h.ctx.serviceWorker,
        async () =>
          (await h.page.evaluate(() => (window as any).lastOrder ?? null)) ||
          null,
        300_000,
        workspaceId,
      );

      const { traceFiles } = await h.printTraceSummary(workspaceId);

      expect(outcome.ok, outcome.reason).toBe(true);

      const order = outcome.result as any;
      expect(order).toBeTruthy();
      expect(order.shippingMethod).toBe("standard");
      expect(order.name).toBe("Kai Schmidt");
      expect(order.email).toBe("kai.profile@example.com");

      expect(
        traceFilesContainText(traceFiles, "get_profile_fields"),
        "The run trace should show the profile retrieval tool being used",
      ).toBe(true);
      expect(
        traceFilesContainText(traceFiles, "identity.first_name"),
        "The run trace should reference the requested first-name field",
      ).toBe(true);
      expect(
        traceFilesContainText(traceFiles, "identity.last_name"),
        "The run trace should reference the requested last-name field",
      ).toBe(true);
      expect(
        traceFilesContainText(traceFiles, "identity.email"),
        "The run trace should reference the requested email field",
      ).toBe(true);

      await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
    }, 360_000);
  },
);
