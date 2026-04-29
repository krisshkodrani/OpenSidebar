import { describe, expect, test } from "vitest";
import "../setup";
import { getProviderKeyStatus } from "../../src/utils/provider-keys";

describe("provider key status", () => {
  test("requires Xiaomi MiMo key for xiaomi mode", () => {
    expect(
      getProviderKeyStatus({
        providerMode: "xiaomi",
        openRouterApiKey: "",
        xiaomiApiKey: "",
      }),
    ).toMatchObject({
      activeKeyName: "Xiaomi MiMo",
      missingKeyNames: ["Xiaomi MiMo"],
      hasRequiredKeys: false,
    });

    expect(
      getProviderKeyStatus({
        providerMode: "xiaomi",
        openRouterApiKey: "",
        xiaomiApiKey: "sk-xiaomi-test",
      }),
    ).toMatchObject({
      activeKey: "sk-xiaomi-test",
      activeKeyName: "Xiaomi MiMo",
      hasRequiredKeys: true,
    });
  });
});
