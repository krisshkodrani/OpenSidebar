import { describe, expect, test } from "vitest";
import type { DomSnapshot, TaggedElement } from "../../src/types";
import type { LLMMessage } from "../../src/background/llm/types";
import {
  attachActualPromptTokens,
  buildObservationProgressKey,
  buildDomPromptDeltaMetrics,
  buildPromptSectionMetrics,
  buildStructuredRuntimeStateShadowMetrics,
  ContextSpendTracker,
  detectObservationProgressSignals,
  detectSemanticProgressSignals,
  resolveContextModeTelemetry,
} from "../../src/background/agent/context-economy";

function element(overrides: Partial<TaggedElement>): TaggedElement {
  return {
    tag: 1,
    tagName: "button",
    role: "button",
    text: "Submit",
    attributes: {},
    rect: { x: 0, y: 0, width: 100, height: 30 },
    isVisible: true,
    isDisabled: false,
    ...overrides,
  };
}

function snapshot(
  elements: TaggedElement[],
  url = "https://example.test",
  overrides: Partial<DomSnapshot> = {},
): DomSnapshot {
  return {
    title: "Example",
    url,
    elements,
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    ...overrides,
  };
}

describe("context economy telemetry", () => {
  test("measures prompt sections without storing raw section content", () => {
    const messages: LLMMessage[] = [
      {
        role: "system",
        content: [
          "You are OpenSidebar.\n",
          "## Tool Reminders\nUse tools.\n",
          "Executor task context.\n",
          "## Page Context\nTitle: Demo\n",
          "## Last Action Outcome\nNone\n",
          "## Visible Elements\n[1] button \"Submit\"\n",
          "## Page Content\nFull page text\n",
          "## Page Interpretation\nReady\n",
          "## Available Tool Capabilities\n- click_elements: click_element\n",
        ].join(""),
      },
      {
        role: "user",
        content: "[DISTILLED HISTORY - 1 actions]\nT1: read_page -> ok",
      },
      { role: "tool", content: "Large tool result", tool_call_id: "tc1" },
      {
        role: "user",
        content: [
          { type: "text", text: "Screenshot included" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,a", detail: "high" },
          },
        ],
      },
    ];

    const metrics = buildPromptSectionMetrics({
      messages,
      estimatedPromptTokens: 123,
    });

    expect(metrics.templateId).toBe("agent.system");
    expect(metrics.templateVersion).toMatch(/^v/);
    expect(metrics.sectionSignatureHash).toMatch(/^[0-9a-f]{8}$/);
    expect(metrics.workingNotesChars).toBe(0);
    expect(metrics.planStatusChars).toBe(0);
    expect(metrics.visibleElementsChars).toBeGreaterThan(0);
    expect(metrics.pageContentChars).toBeGreaterThan(0);
    expect(metrics.toolCapabilityCatalogChars).toBeGreaterThan(0);
    expect(metrics.toolOutputChars).toBe("Large tool result".length);
    expect(metrics.distillationSummaryChars).toBeGreaterThan(0);
    expect(metrics.imagePromptCount).toBe(1);
    expect(metrics.lowDetailImagePromptCount).toBe(0);
    expect(metrics.highDetailImagePromptCount).toBe(1);
    expect(metrics.autoDetailImagePromptCount).toBe(0);
    expect(metrics.estimatedImagePromptTokens).toBe(765);
  });

  test("estimates structured runtime-state savings without changing prompts", () => {
    const messages: LLMMessage[] = [
      {
        role: "system",
        content: [
          "System\n",
          "## Working Notes\nReason: user needs a verified checkout path.\n",
          "## Plan [2/3] \"Fill shipping form\"\nDone: opened checkout\n",
          "## Page Context\nTitle: Checkout\n",
          "## Last Action Outcome\nTool: fill_form\nResult: blocked because zip was invalid\n",
          "## Visible Elements\n[1] input \"Zip\"\n",
        ].join(""),
      },
      {
        role: "tool",
        content: "The form showed a validation blocker because zip is required.",
        tool_call_id: "tc1",
      },
    ];
    const promptSections = buildPromptSectionMetrics({
      messages,
      estimatedPromptTokens: 200,
    });

    const shadow = buildStructuredRuntimeStateShadowMetrics({
      promptSections,
      messages,
    });

    expect(shadow.shadowOnly).toBe(true);
    expect(shadow.comprehensionGateRequired).toBe(true);
    expect(shadow.proseStateChars).toBeGreaterThan(0);
    expect(shadow.fields.planStatusChars).toBeGreaterThan(0);
    expect(shadow.fields.workingNotesChars).toBeGreaterThan(0);
    expect(shadow.preservedRationaleChars).toBeGreaterThan(0);
    expect(shadow.estimatedSavingsChars).toBeGreaterThanOrEqual(0);
  });

  test("records estimator drift once actual prompt tokens are known", () => {
    const metrics = buildPromptSectionMetrics({
      messages: [{ role: "system", content: "System" }],
      estimatedPromptTokens: 120,
    });

    const updated = attachActualPromptTokens(metrics, 100);

    expect(updated.actualPromptTokens).toBe(100);
    expect(updated.estimatorErrorPct).toBe(20);
  });

  test("classifies context mode in shadow without changing active full mode", () => {
    const formMode = resolveContextModeTelemetry({
      messages: [{ role: "system", content: "Fill the visible form." }],
      snapshot: snapshot([
        element({
          tag: 2,
          tagName: "input",
          role: "textbox",
          text: "",
          attributes: { type: "email" },
        }),
      ]),
    });

    expect(formMode.active).toBe("full");
    expect(formMode.shadowCandidate).toBe("form_compact");

    const extractionMode = resolveContextModeTelemetry({
      messages: [{ role: "user", content: "Read all listings and compare them." }],
      snapshot: snapshot([]),
    });

    expect(extractionMode.shadowCandidate).toBe("extraction_full");
  });

  test("computes DOM delta shadow metrics with stability and break-even checks", () => {
    const previous = snapshot([
      element({ tag: 1, text: "Submit" }),
      element({ tag: 2, tagName: "input", role: "textbox", text: "", attributes: { name: "email" } }),
    ]);
    const current = snapshot([
      element({ tag: 1, text: "Submit" }),
      element({ tag: 2, tagName: "input", role: "textbox", text: "", attributes: { name: "email", value: "a@example.com" } }),
      element({ tag: 3, text: "Cancel" }),
    ]);

    const delta = buildDomPromptDeltaMetrics({ previous, current, cause: "last_action" });

    expect(delta).not.toBeNull();
    expect(delta?.shadowOnly).toBe(true);
    expect(delta?.addedCount).toBe(1);
    expect(delta?.changedCount).toBe(1);
    expect(delta?.stability.stableTagReusePct).toBeGreaterThan(50);
    expect(typeof delta?.breakEven).toBe("boolean");
  });

  test("detects field readback changes as semantic progress", () => {
    const previous = snapshot([
      element({
        tag: 2,
        tagName: "input",
        role: "textbox",
        text: "",
        attributes: { value: "" },
      }),
    ]);
    const current = snapshot([
      element({
        tag: 2,
        tagName: "input",
        role: "textbox",
        text: "",
        attributes: { value: "SKU-4829" },
      }),
    ]);

    const signals = detectSemanticProgressSignals({
      toolName: "type_text",
      toolArgs: { id: 2, text: "SKU-4829" },
      previousSnapshot: previous,
      currentSnapshot: current,
    });

    expect(signals).toContainEqual({
      strength: "strong",
      label: "field_state_changed",
      observed: true,
    });
  });

  test("detects newly visible result or status text as semantic progress", () => {
    const previous = snapshot([], "https://example.test/catalog", {
      pageContent: "Product Inventory\nSearch products",
    });
    const current = snapshot([], "https://example.test/catalog", {
      pageContent:
        "Product Inventory\nShowing products in: Electronics\nWidget X",
    });

    const signals = detectSemanticProgressSignals({
      toolName: "click_element",
      toolArgs: { id: 5 },
      previousSnapshot: previous,
      currentSnapshot: current,
    });

    expect(signals).toContainEqual({
      strength: "strong",
      label: "semantic_page_state_changed",
      observed: true,
    });
  });

  test("detects newly visible element text as semantic progress", () => {
    const previous = snapshot([
      element({ tag: 1, text: "Products" }),
    ]);
    const current = snapshot([
      element({ tag: 1, text: "Products" }),
      element({ tag: 2, tagName: "span", role: "span", text: "Info for Widget X" }),
    ]);

    const signals = detectSemanticProgressSignals({
      toolName: "click_element",
      toolArgs: { id: 5 },
      previousSnapshot: previous,
      currentSnapshot: current,
    });

    expect(signals).toContainEqual({
      strength: "medium",
      label: "visible_text_added",
      observed: true,
    });
  });

  test("does not treat unchanged status text as fresh semantic progress", () => {
    const previous = snapshot([], "https://example.test/catalog", {
      pageContent: "Product Inventory\nShowing products in: Electronics",
    });
    const current = snapshot([], "https://example.test/catalog", {
      pageContent: "Product Inventory\nShowing products in: Electronics",
    });

    expect(
      detectSemanticProgressSignals({
        toolName: "click_element",
        toolArgs: { id: 5 },
        previousSnapshot: previous,
        currentSnapshot: current,
      }),
    ).toEqual([]);
  });

  test("detects new successful read observations as context progress", () => {
    const signals = detectObservationProgressSignals({
      toolName: "read_page",
      resultContent:
        "Page: Product Inventory\nShowing products in: Electronics\nWidget X SKU: SKU-4829",
      alreadySeen: false,
    });

    expect(signals).toEqual([
      {
        strength: "medium",
        label: "new_observation",
        observed: true,
      },
      {
        strength: "weak",
        label: "successful_read_tool",
        observed: true,
      },
    ]);
  });

  test("does not count repeated or failed observations as context progress", () => {
    expect(
      detectObservationProgressSignals({
        toolName: "read_page",
        resultContent: "Page: Product Inventory",
        alreadySeen: true,
      }),
    ).toEqual([]);

    expect(
      detectObservationProgressSignals({
        toolName: "find_element",
        resultContent: "Not found: Widget X",
        alreadySeen: false,
      }),
    ).toEqual([]);
  });

  test("builds stable observation progress keys from normalized content", () => {
    const first = buildObservationProgressKey({
      toolName: "read_page",
      resultContent: "Page:\nWidget X    SKU-4829",
      snapshotFingerprint: "abc",
    });
    const second = buildObservationProgressKey({
      toolName: "read_page",
      resultContent: "Page: Widget X SKU-4829",
      snapshotFingerprint: "abc",
    });

    expect(first).toBe(second);
  });
});

describe("ContextSpendTracker", () => {
  test("triggers thresholds from token spend and does not reset on URL-only progress", () => {
    const tracker = new ContextSpendTracker();

    let sample = tracker.recordUsage(1, {
      prompt_tokens: 30_000,
      completion_tokens: 100,
      total_tokens: 30_100,
    });
    expect(sample.threshold).toBe("none");

    expect(
      tracker.recordProgress(1, [
        { strength: "weak", label: "url_changed", observed: true },
      ]),
    ).toBe(false);

    sample = tracker.recordUsage(2, {
      prompt_tokens: 30_000,
      completion_tokens: 100,
      total_tokens: 30_100,
    });
    expect(sample.threshold).toBe("distill");
  });

  test("resets spend counters on strong observed progress", () => {
    const tracker = new ContextSpendTracker();
    tracker.recordUsage(1, {
      prompt_tokens: 70_000,
      completion_tokens: 100,
      total_tokens: 70_100,
    });

    expect(
      tracker.recordProgress(1, [
        { strength: "strong", label: "field_readback_changed", observed: true },
      ]),
    ).toBe(true);

    const sample = tracker.snapshot(1);
    expect(sample.promptTokensSinceProgress).toBe(0);
    expect(sample.threshold).toBe("none");
  });

  test("resets spend counters from paired medium progress signals", () => {
    const tracker = new ContextSpendTracker();
    tracker.recordUsage(1, {
      prompt_tokens: 70_000,
      completion_tokens: 100,
      total_tokens: 70_100,
    });

    expect(
      tracker.recordProgress(1, [
        { strength: "medium", label: "visible_text_added", observed: true },
        { strength: "medium", label: "action_effect_delta", observed: true },
      ]),
    ).toBe(true);

    expect(tracker.snapshot(1).threshold).toBe("none");
  });

  test("resets spend counters from medium delta plus targeted action effect", () => {
    const tracker = new ContextSpendTracker();
    tracker.recordUsage(1, {
      prompt_tokens: 70_000,
      completion_tokens: 100,
      total_tokens: 70_100,
    });

    expect(
      tracker.recordProgress(1, [
        { strength: "medium", label: "action_effect_delta", observed: true },
        { strength: "weak", label: "targeted_action_effect", observed: true },
      ]),
    ).toBe(true);

    expect(tracker.snapshot(1).lastProgressSignal).toBe(
      "action_effect_delta+targeted_action_effect",
    );
  });
});
