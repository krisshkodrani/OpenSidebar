import { describe, expect, it } from "vitest";
import { createMockOverlayBrowserPagePort } from "../e2e/helpers/overlay-page-port";

describe("mock overlay browser page port", () => {
  it("exposes URL, title, screenshot, and typed evaluate without a browser", async () => {
    const screenshot = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff,
    ]);
    const page = createMockOverlayBrowserPagePort({
      url: "https://example.test/mock",
      title: "Mock page",
      screenshot,
    });

    await expect(page.getUrl()).resolves.toBe("https://example.test/mock");
    await expect(page.getTitle()).resolves.toBe("Mock page");
    await expect(page.screenshot({ fullPage: true })).resolves.toBe(screenshot);
    await expect(
      page.evaluate(async (left, right) => left + right, 2, 3),
    ).resolves.toBe(5);
    expect(page.calls.screenshots).toEqual([{ fullPage: true }]);
    await expect(page.evaluate(() => {
      throw new Error("mock evaluate failure");
    })).rejects.toThrow("mock evaluate failure");
  });

  it("records selector and predicate readiness options", async () => {
    const page = createMockOverlayBrowserPagePort({
      selectors: ["#opensidebar-harness-host"],
    });

    await expect(
      page.waitForSelector("#opensidebar-harness-host", {
        timeout: 25,
      }),
    ).resolves.toBeUndefined();
    await expect(
      page.waitForFunction(
        async (value) => value === "ready",
        { timeout: 50 },
        "ready",
      ),
    ).resolves.toBeUndefined();

    expect(page.calls.waitForSelectors).toEqual([
      {
        selector: "#opensidebar-harness-host",
        options: { timeout: 25 },
      },
    ]);
    expect(page.calls.waitForFunctions).toEqual(
      expect.arrayContaining([{ options: { timeout: 50 } }]),
    );
  });

  it("models selector and predicate readiness without leaking handles", async () => {
    const page = createMockOverlayBrowserPagePort({
      selectors: ["#opensidebar-harness-host"],
    });

    await expect(
      page.waitForSelector("#opensidebar-harness-host"),
    ).resolves.toBeUndefined();
    await expect(page.waitForSelector("#missing")).rejects.toThrow(
      "Selector did not resolve to an element: #missing",
    );
    await expect(
      page.waitForFunction((value) => value === "ready", undefined, "ready"),
    ).resolves.toBeUndefined();
    await expect(
      page.waitForFunction(() => false),
    ).rejects.toThrow("Wait predicate did not resolve to a truthy value.");
  });
});
