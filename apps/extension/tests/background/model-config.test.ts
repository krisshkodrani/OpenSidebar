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

  test("judge seat defaults to a dedicated fast model, decoupled from the planner", () => {
    // RFC LP-15 Phase 10 seat, retuned 2026-07-09: sharing the GLM planner
    // seat made ~75% of judge calls time out behind planner traffic and fail
    // open. The judge is a text-only strict-JSON rubric task — GPT-OSS-120B
    // (Fireworks-served) answers fast enough to actually rule.
    expect(LLM_MODEL_CONFIG.judge).toBe(
      "accounts/fireworks/models/gpt-oss-120b",
    );
    expect(LLM_MODEL_CONFIG.judge).not.toBe(LLM_MODEL_CONFIG.planner);
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
