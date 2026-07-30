import { describe, expect, test } from "vitest";
import "../setup";
import {
  getAvailableProviderStacks,
  getProviderKeyStatus,
  reconcileProviderSelection,
  resolveAvailableProviderMode,
} from "../../src/utils/provider-keys";

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

  test("only exposes stacks backed by the configured keys", () => {
    expect(
      getAvailableProviderStacks({
        providerMode: "openrouter",
        openRouterApiKey: "sk-openrouter-test",
        fireworksApiKey: "fw-test",
        groqApiKey: "",
        deepseekApiKey: "",
      }).map((option) => option.mode),
    ).toEqual(["openrouter", "fireworks"]);

    expect(
      getAvailableProviderStacks({
        providerMode: "openrouter",
        openRouterApiKey: "sk-openrouter-test",
        fireworksApiKey: "fw-test",
        groqApiKey: "gsk-test",
        deepseekApiKey: "sk-deepseek-test",
      }).map((option) => option.mode),
    ).toEqual(["openrouter", "fireworks"]);
  });

  test("does not expose experimental, hybrid, or legacy stacks", () => {
    expect(
      getAvailableProviderStacks({
        providerMode: "openai-groq",
        openRouterApiKey: "",
        openaiApiKey: "sk-openai-test",
        groqApiKey: "gsk-test",
        deepseekApiKey: "sk-deepseek-test",
        cerebrasApiKey: "csk-test",
      }),
    ).toEqual([]);
  });

  test("keeps a valid selection and otherwise chooses the first usable stack", () => {
    expect(
      resolveAvailableProviderMode({
        providerMode: "fireworks",
        openRouterApiKey: "sk-openrouter-test",
        fireworksApiKey: "fw-test",
      }),
    ).toBe("fireworks");

    expect(
      resolveAvailableProviderMode({
        providerMode: "fireworks-deepseek",
        openRouterApiKey: "sk-openrouter-test",
        fireworksApiKey: "fw-test",
        deepseekApiKey: "",
      }),
    ).toBe("fireworks");

    expect(
      resolveAvailableProviderMode({
        providerMode: "xiaomi",
        openRouterApiKey: "sk-openrouter-test",
        xiaomiApiKey: "",
      }),
    ).toBe("openrouter");

    expect(
      resolveAvailableProviderMode({
        providerMode: "openrouter",
        openRouterApiKey: "   ",
      }),
    ).toBeUndefined();
  });

  test("falls back safely and clears provider-specific model overrides", () => {
    const reconciled = reconcileProviderSelection({
      providerMode: "openrouter-groq",
      openRouterApiKey: "sk-openrouter-test",
      groqApiKey: "",
      executorModel: "openai/gpt-5.4-mini",
      plannerModel: "openai/gpt-oss-120b",
      writerModel: "anthropic/claude-test",
      maxTurns: 100,
      theme: "system",
      showSessionMetrics: true,
      requireApprovals: true,
      allowNavigation: true,
    });

    expect(reconciled.providerMode).toBe("openrouter");
    expect("executorModel" in reconciled).toBe(false);
    expect("plannerModel" in reconciled).toBe(false);
    expect("writerModel" in reconciled).toBe(false);
  });
});
