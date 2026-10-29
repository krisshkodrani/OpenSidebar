import { describe, expect, test } from "vitest";
import "../setup";
import {
  formatMissingProviderKeys,
  getProviderKeyStatus,
  hasProviderCredentials,
} from "../../src/utils/provider-keys";

describe("provider key status", () => {
  test("cloud mode needs no local key", () => {
    expect(
      getProviderKeyStatus({ inferenceMode: "cloud", openRouterApiKey: "" }),
    ).toMatchObject({
      activeKey: "__opensidebar_cloud__",
      activeKeyName: "OpenSidebar Cloud",
      hasRequiredKeys: true,
    });
  });

  test("switching explicitly to local mode never retains the cloud sentinel", () => {
    expect(
      getProviderKeyStatus({
        inferenceMode: "local",
        openRouterApiKey: "local-key",
      }),
    ).toMatchObject({
      activeKey: "local-key",
      activeKeyName: "OpenRouter",
      hasRequiredKeys: true,
    });
    expect(
      getProviderKeyStatus({ inferenceMode: "local", openRouterApiKey: "" }),
    ).toMatchObject({ hasRequiredKeys: false });
  });

  test("requires an OpenRouter key in local mode", () => {
    const status = getProviderKeyStatus({ openRouterApiKey: "   " });
    expect(status).toMatchObject({
      activeKey: undefined,
      activeKeyName: "OpenRouter",
      missingKeyNames: ["OpenRouter"],
      hasRequiredKeys: false,
    });
    expect(formatMissingProviderKeys(status)).toBe("OpenRouter");
  });

  test("trims the OpenRouter key", () => {
    expect(
      getProviderKeyStatus({ openRouterApiKey: "  sk-or-test  " }),
    ).toMatchObject({ activeKey: "sk-or-test", hasRequiredKeys: true });
  });

  test("names the active provider when nothing is missing", () => {
    expect(
      formatMissingProviderKeys(
        getProviderKeyStatus({ openRouterApiKey: "sk-or-test" }),
      ),
    ).toBe("OpenRouter");
  });

  test("hasProviderCredentials is true for cloud mode or an OpenRouter key", () => {
    expect(hasProviderCredentials({ openRouterApiKey: "" })).toBe(false);
    expect(hasProviderCredentials({ openRouterApiKey: "  " })).toBe(false);
    expect(hasProviderCredentials({ openRouterApiKey: "sk-or-test" })).toBe(
      true,
    );
    expect(
      hasProviderCredentials({ inferenceMode: "cloud", openRouterApiKey: "" }),
    ).toBe(true);
  });
});
