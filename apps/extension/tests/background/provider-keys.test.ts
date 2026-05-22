import { describe, expect, test } from "vitest";
import "../setup";
import { getProviderKeyStatus } from "../../src/utils/provider-keys";

describe("provider key status", () => {
  test("requires both executor and planner keys for OpenRouter + Groq mode", () => {
    expect(
      getProviderKeyStatus({
        providerMode: "openrouter-groq",
        openRouterApiKey: "sk-openrouter-test",
        groqApiKey: "",
      }),
    ).toMatchObject({
      activeKeyName: "OpenRouter and Groq",
      missingKeyNames: ["Groq"],
      hasRequiredKeys: false,
    });

    expect(
      getProviderKeyStatus({
        providerMode: "openrouter-groq",
        openRouterApiKey: "",
        groqApiKey: "sk-groq-test",
      }),
    ).toMatchObject({
      missingKeyNames: ["OpenRouter"],
      hasRequiredKeys: false,
    });

    expect(
      getProviderKeyStatus({
        providerMode: "openrouter-groq",
        openRouterApiKey: "sk-openrouter-test",
        groqApiKey: "sk-groq-test",
      }),
    ).toMatchObject({
      activeKey: "sk-openrouter-test",
      activeKeyName: "OpenRouter and Groq",
      hasRequiredKeys: true,
    });
  });

  test("requires both executor and planner keys for OpenAI + Groq mode", () => {
    expect(
      getProviderKeyStatus({
        providerMode: "openai-groq",
        openRouterApiKey: "",
        openaiApiKey: "sk-openai-test",
        groqApiKey: "",
      }),
    ).toMatchObject({
      activeKeyName: "OpenAI and Groq",
      missingKeyNames: ["Groq"],
      hasRequiredKeys: false,
    });

    expect(
      getProviderKeyStatus({
        providerMode: "openai-groq",
        openRouterApiKey: "",
        openaiApiKey: "sk-openai-test",
        groqApiKey: "sk-groq-test",
      }),
    ).toMatchObject({
      activeKey: "sk-openai-test",
      activeKeyName: "OpenAI and Groq",
      hasRequiredKeys: true,
    });
  });

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
