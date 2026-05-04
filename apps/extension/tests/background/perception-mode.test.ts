import { describe, expect, test } from "vitest";
import {
  extractPerceptionPageSignals,
  resolvePerceptionRuntimeMode,
  resolvePerceptionRuntimeModeDecision,
} from "../../src/utils/perception-mode";

describe("perception mode resolution", () => {
  test("auto uses structured text mode when DOM signals are sufficient", () => {
    expect(
      resolvePerceptionRuntimeModeDecision({
        perceptionMode: "auto",
        providerMode: "fireworks",
        elementCount: 20,
        pageTextLength: 2000,
      }),
    ).toMatchObject({
      mode: "structured",
      reason: "dom_signals_sufficient",
      signals: [],
    });
  });

  test("auto selects unified VL for visual task text", () => {
    expect(
      resolvePerceptionRuntimeModeDecision({
        perceptionMode: "auto",
        providerMode: "moonshot",
        taskText: "Read the chart and tell me the highest value",
        elementCount: 20,
        pageTextLength: 2000,
      }),
    ).toMatchObject({
      mode: "unified_vl",
      reason: "visual_task_text",
      signals: ["visual_task_text"],
    });
  });

  test("auto selects unified VL for sparse DOM", () => {
    expect(
      resolvePerceptionRuntimeModeDecision({
        perceptionMode: "auto",
        providerMode: "fireworks-deepseek",
        elementCount: 1,
        pageTextLength: 100,
      }),
    ).toMatchObject({
      mode: "unified_vl",
      reason: "sparse_dom",
    });
  });

  test("auto selects unified VL for canvas, svg, and image-heavy pages", () => {
    expect(
      resolvePerceptionRuntimeMode({
        perceptionMode: "auto",
        hasCanvas: true,
        elementCount: 20,
        pageTextLength: 2000,
      }),
    ).toBe("unified_vl");
    expect(
      resolvePerceptionRuntimeMode({
        perceptionMode: "auto",
        hasSvg: true,
        elementCount: 20,
        pageTextLength: 2000,
      }),
    ).toBe("unified_vl");
    expect(
      resolvePerceptionRuntimeMode({
        perceptionMode: "auto",
        imageCount: 3,
        elementCount: 20,
        pageTextLength: 2000,
      }),
    ).toBe("unified_vl");
  });

  test("records all auto signals while using the first signal as reason", () => {
    expect(
      resolvePerceptionRuntimeModeDecision({
        perceptionMode: "auto",
        taskText: "Describe the visual chart",
        hasCanvas: true,
        imageCount: 3,
        elementCount: 1,
        pageTextLength: 100,
      }),
    ).toMatchObject({
      mode: "unified_vl",
      reason: "visual_task_text",
      signals: [
        "visual_task_text",
        "canvas_present",
        "image_heavy_page",
        "sparse_dom",
      ],
    });
  });

  test("respects explicit structured override", () => {
    expect(
      resolvePerceptionRuntimeMode({
        perceptionMode: "structured",
        providerMode: "fireworks",
      }),
    ).toBe("structured");
  });

  test("respects explicit unified VL override", () => {
    expect(
      resolvePerceptionRuntimeMode({
        perceptionMode: "unified_vl",
        elementCount: 20,
        pageTextLength: 2000,
      }),
    ).toBe("unified_vl");
  });

  test("keeps legacy useVLExecutor true as unified VL and lets false fall through to auto", () => {
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
        elementCount: 20,
        pageTextLength: 2000,
      }),
    ).toBe("structured");
  });

  test("extracts page signals from snapshot tags and text", () => {
    expect(
      extractPerceptionPageSignals({
        elements: [
          {
            tag: 1,
            tagName: "button",
            role: "button",
            text: "Open",
            attributes: {},
            rect: { x: 0, y: 0, width: 10, height: 10 },
            isVisible: true,
            isDisabled: false,
          },
        ],
        visibleContent: "Short",
        pageContent: "Short page",
        framework: "react",
        skeleton: [
          {
            tagName: "canvas",
            role: "canvas",
            text: "",
            depth: 0,
          },
        ],
      }),
    ).toMatchObject({
      elementCount: 1,
      visibleTextLength: 5,
      pageTextLength: 10,
      hasCanvas: true,
      framework: "react",
    });
  });
});
