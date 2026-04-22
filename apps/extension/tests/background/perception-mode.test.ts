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

  test("defaults non-Fireworks stacks to structured perception", () => {
    expect(
      resolvePerceptionRuntimeMode({
        perceptionMode: "auto",
        providerMode: "openrouter",
      }),
    ).toBe("structured");
  });

  test("respects explicit structured override", () => {
    expect(
      resolvePerceptionRuntimeMode({
        perceptionMode: "structured",
        providerMode: "fireworks",
      }),
    ).toBe("structured");
  });

  test("supports legacy useVLExecutor fallback", () => {
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
    ).toBe("structured");
  });
});
