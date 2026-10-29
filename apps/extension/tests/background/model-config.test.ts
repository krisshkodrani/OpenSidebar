import { describe, expect, test } from "vitest";
import {
  DEFAULT_LLM_MODEL_CONFIG,
  LLM_MODEL_CONFIG,
  resolveLLMModelConfig,
} from "../../src/config/model-config";

describe("LLM model config", () => {
  test("uses checked-in defaults", () => {
    expect(LLM_MODEL_CONFIG).toEqual(DEFAULT_LLM_MODEL_CONFIG);
    expect(LLM_MODEL_CONFIG.executor).toBe("openai/gpt-6-luna");
  });

  test("every seat uses an OpenRouter catalog-form id", () => {
    for (const [seat, model] of Object.entries(LLM_MODEL_CONFIG)) {
      expect(
        model.startsWith("accounts/"),
        `${seat} (${model}) is not an OpenRouter catalog id`,
      ).toBe(false);
      expect(model).toContain("/");
    }
  });

  test("judge seat is decoupled from the planner", () => {
    // RFC LP-15 Phase 10 seat: sharing the planner seat made most judge calls
    // time out behind planner traffic and fail open.
    expect(LLM_MODEL_CONFIG.judge).toBe("typesafe/jev-1.13");
    expect(LLM_MODEL_CONFIG.judge).not.toBe(LLM_MODEL_CONFIG.planner);
  });

  test("accepts a judge model override, else keeps the default", () => {
    expect(resolveLLMModelConfig({ judge: "custom/judge" }).judge).toBe(
      "custom/judge",
    );
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
        writer: 42,
      }),
    ).toMatchObject({
      executor: DEFAULT_LLM_MODEL_CONFIG.executor,
      planner: "custom/planner",
      writer: DEFAULT_LLM_MODEL_CONFIG.writer,
    });
  });
});
