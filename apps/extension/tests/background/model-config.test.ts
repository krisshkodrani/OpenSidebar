import { describe, expect, test } from "vitest";
import {
  DEFAULT_LLM_MODEL_CONFIG,
  LLM_MODEL_CONFIG,
  resolveLLMModelConfig,
} from "../../src/config/model-config";

describe("LLM model config", () => {
  test("uses checked-in defaults", () => {
    expect(LLM_MODEL_CONFIG).toEqual(DEFAULT_LLM_MODEL_CONFIG);
    expect(LLM_MODEL_CONFIG.executor).toBe(
      "accounts/fireworks/models/kimi-k2p7-code",
    );
    expect(LLM_MODEL_CONFIG.deepseek.planner).toBe("deepseek-v4-flash");
  });

  test("judge seat defaults to the planner model (GLM-5.2)", () => {
    // RFC LP-15 Phase 10: the judge seat exists and mirrors the planner model.
    expect(LLM_MODEL_CONFIG.judge).toBe("accounts/fireworks/models/glm-5p2");
    expect(LLM_MODEL_CONFIG.judge).toBe(LLM_MODEL_CONFIG.planner);
  });

  test("accepts a judge model override, else keeps the default", () => {
    expect(
      resolveLLMModelConfig({ judge: "custom/judge" }).judge,
    ).toBe("custom/judge");
    expect(resolveLLMModelConfig({ judge: "" }).judge).toBe(
      DEFAULT_LLM_MODEL_CONFIG.judge,
    );
  });

  test("falls back to defaults for malformed config", () => {
    expect(resolveLLMModelConfig(null)).toEqual(DEFAULT_LLM_MODEL_CONFIG);
    expect(resolveLLMModelConfig("bad")).toEqual(DEFAULT_LLM_MODEL_CONFIG);
    expect(resolveLLMModelConfig([])).toEqual(DEFAULT_LLM_MODEL_CONFIG);
  });

  test("keeps defaults for missing or invalid entries", () => {
    expect(
      resolveLLMModelConfig({
        executor: "",
        planner: "custom/planner",
        deepseek: {
          planner: "deepseek-custom",
          plannerPro: "",
        },
      }),
    ).toMatchObject({
      executor: DEFAULT_LLM_MODEL_CONFIG.executor,
      planner: "custom/planner",
      deepseek: {
        planner: "deepseek-custom",
        plannerPro: DEFAULT_LLM_MODEL_CONFIG.deepseek.plannerPro,
      },
    });
  });
});
