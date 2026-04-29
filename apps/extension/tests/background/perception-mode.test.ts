import { describe, expect, test } from "vitest";
import { resolvePerceptionRuntimeMode } from "../../src/utils/perception-mode";

describe("perception mode resolution", () => {
  test("defaults Fireworks to unified VL", () => {
    expect(
      resolvePerceptionRuntimeMode({
        perceptionMode: "auto",
        providerMode: "fireworks",
      }),
    ).toBe("unified_vl");
  });

  test("defaults Moonshot to unified VL", () => {
    expect(
      resolvePerceptionRuntimeMode({
        perceptionMode: "auto",
        providerMode: "moonshot",
      }),
    ).toBe("unified_vl");
  });

  test("defaults Fireworks + DeepSeek hybrid to unified VL", () => {
    expect(
      resolvePerceptionRuntimeMode({
        perceptionMode: "auto",
        providerMode: "fireworks-deepseek",
      }),
    ).toBe("unified_vl");
  });

  test("defaults non-Fireworks stacks to unified VL", () => {
    expect(
      resolvePerceptionRuntimeMode({
        perceptionMode: "auto",
        providerMode: "openrouter",
      }),
    ).toBe("unified_vl");
  });

  test("respects explicit structured override", () => {
    expect(
      resolvePerceptionRuntimeMode({
        perceptionMode: "structured",
        providerMode: "fireworks",
      }),
    ).toBe("structured");
  });

  test("ignores legacy useVLExecutor false in favor of unified VL", () => {
    expect(
      resolvePerceptionRuntimeMode({
        useVLExecutor: true,
        providerMode: "openrouter",
      }),
    ).toBe("unified_vl");
    expect(
      resolvePerceptionRuntimeMode({
        useVLExecutor: false,
        providerMode: "fireworks",
      }),
    ).toBe("unified_vl");
  });
});
