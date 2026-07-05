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

  test("auto falls back to structured mode when image budget is exhausted", () => {
    expect(
      resolvePerceptionRuntimeModeDecision({
        perceptionMode: "auto",
        taskText: "Read the chart and tell me the highest value",
        elementCount: 20,
        pageTextLength: 2000,
        imagePromptTokensUsed: 1_000,
        maxImagePromptTokens: 1_500,
        nextImagePromptTokenEstimate: 765,
      }),
    ).toMatchObject({
      mode: "structured",
      reason: "image_budget_exhausted",
      signals: ["visual_task_text", "image_budget_exhausted"],
    });
  });

  test("explicit unified VL override is not downgraded by auto image budget", () => {
    expect(
      resolvePerceptionRuntimeMode({
        perceptionMode: "unified_vl",
        taskText: "Read the chart",
        imagePromptTokensUsed: 1_000,
        maxImagePromptTokens: 1_500,
        nextImagePromptTokenEstimate: 765,
      }),
    ).toBe("unified_vl");
  });

  test("non-VL executor forces structured over the explicit unified VL override", () => {
    expect(
      resolvePerceptionRuntimeModeDecision({
        perceptionMode: "unified_vl",
        executorVLCapable: false,
      }),
    ).toMatchObject({
      mode: "structured",
      reason: "executor_not_vl_capable",
      signals: [],
    });
  });

  test("non-VL executor forces structured despite visual signals and legacy toggle", () => {
    expect(
      resolvePerceptionRuntimeModeDecision({
        perceptionMode: "auto",
        useVLExecutor: true,
        executorVLCapable: false,
        taskText: "Read the chart and tell me the highest value",
        hasCanvas: true,
        elementCount: 2,
        pageTextLength: 100,
      }),
    ).toMatchObject({
      mode: "structured",
      reason: "executor_not_vl_capable",
    });
  });

  test("VL-capable executor leaves auto decisions unchanged", () => {
    expect(
      resolvePerceptionRuntimeModeDecision({
        perceptionMode: "auto",
        executorVLCapable: true,
        taskText: "Read the chart and tell me the highest value",
        elementCount: 20,
        pageTextLength: 2000,
      }),
    ).toMatchObject({
      mode: "unified_vl",
      reason: "visual_task_text",
    });
  });

  test("unknown executor capability preserves current behavior", () => {
    expect(
      resolvePerceptionRuntimeMode({
        perceptionMode: "unified_vl",
        executorVLCapable: undefined,
      }),
    ).toBe("unified_vl");
  });

  // --- LP-11 A/B: dual auto-mode default -------------------------------

  test("arm A (structured default): no-signal page stays structured", () => {
    expect(
      resolvePerceptionRuntimeModeDecision({
        perceptionMode: "auto",
        autoDefaultMode: "structured",
        elementCount: 20,
        pageTextLength: 1000,
      }),
    ).toMatchObject({ mode: "structured", reason: "dom_signals_sufficient" });
  });

  test("arm B (unified_vl default): no-signal page goes unified_vl", () => {
    expect(
      resolvePerceptionRuntimeModeDecision({
        perceptionMode: "auto",
        autoDefaultMode: "unified_vl",
        elementCount: 20,
        pageTextLength: 1000,
      }),
    ).toMatchObject({ mode: "unified_vl", reason: "default_unified_vl" });
  });

  test("arm B: dense text-heavy DOM argues FOR structured", () => {
    expect(
      resolvePerceptionRuntimeModeDecision({
        perceptionMode: "auto",
        autoDefaultMode: "unified_vl",
        elementCount: 60,
        pageTextLength: 5000,
      }),
    ).toMatchObject({
      mode: "structured",
      reason: "dense_text_dom",
      signals: ["dense_text_dom"],
    });
  });

  test("arm B: a visual signal beats dense text", () => {
    expect(
      resolvePerceptionRuntimeModeDecision({
        perceptionMode: "auto",
        autoDefaultMode: "unified_vl",
        hasCanvas: true,
        elementCount: 60,
        pageTextLength: 5000,
      }),
    ).toMatchObject({ mode: "unified_vl", reason: "canvas_present" });
  });

  test("arm B: exhausted image budget falls back to structured on the default path", () => {
    expect(
      resolvePerceptionRuntimeModeDecision({
        perceptionMode: "auto",
        autoDefaultMode: "unified_vl",
        elementCount: 20,
        pageTextLength: 1000,
        imagePromptTokensUsed: 24_500,
        maxImagePromptTokens: 25_000,
        nextImagePromptTokenEstimate: 765,
      }),
    ).toMatchObject({ mode: "structured", reason: "image_budget_exhausted" });
  });

  test("arm B: non-VL executor still forces structured", () => {
    expect(
      resolvePerceptionRuntimeModeDecision({
        perceptionMode: "auto",
        autoDefaultMode: "unified_vl",
        executorVLCapable: false,
        elementCount: 20,
        pageTextLength: 1000,
      }),
    ).toMatchObject({ mode: "structured", reason: "executor_not_vl_capable" });
  });

  test("arm B: below-dense thresholds stay unified_vl", () => {
    expect(
      resolvePerceptionRuntimeModeDecision({
        perceptionMode: "auto",
        autoDefaultMode: "unified_vl",
        elementCount: 39,
        pageTextLength: 5000,
      }),
    ).toMatchObject({ mode: "unified_vl", reason: "default_unified_vl" });
    expect(
      resolvePerceptionRuntimeModeDecision({
        perceptionMode: "auto",
        autoDefaultMode: "unified_vl",
        elementCount: 60,
        pageTextLength: 1999,
      }),
    ).toMatchObject({ mode: "unified_vl", reason: "default_unified_vl" });
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
