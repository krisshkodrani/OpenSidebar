import { describe, test, expect } from "vitest";
import {
  getAvailableProviderStacks,
  getProviderKeyStatus,
  formatMissingProviderKeys,
} from "../../src/utils/provider-keys";
describe("OpenRouter credentials", () => {
  test("offers exactly one gateway with a configured key", () => {
    expect(
      getAvailableProviderStacks({ openRouterApiKey: "key" }).map(
        (x) => x.mode,
      ),
    ).toEqual(["openrouter"]);
  });
  test("shows missing-key guidance without another provider fallback", () => {
    const status = getProviderKeyStatus({ openRouterApiKey: "" });
    expect(status.hasRequiredKeys).toBe(false);
    expect(formatMissingProviderKeys(status)).toBe("OpenRouter");
  });
  test("trims the local credential", () => {
    expect(getProviderKeyStatus({ openRouterApiKey: " key " }).activeKey).toBe(
      "key",
    );
  });
});
