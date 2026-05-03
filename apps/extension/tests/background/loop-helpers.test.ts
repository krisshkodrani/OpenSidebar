import { describe, expect, it } from "vitest";

import { ACTION_EFFECT } from "../../src/background/agent/constants";
import {
  assessElementIdPreDispatch,
  assessFailedActionRepeat,
  assessPreflightElement,
  assessRedundantSuccessBlock,
  assessReadElementSameIdNudge,
  assessToolCacheHit,
  buildZeroEffectDecision,
} from "../../src/background/agent/loop-helpers";
import { ToolResultCache } from "../../src/background/agent/tool-cache";
import { ToolName } from "../../src/types";

describe("buildZeroEffectDecision", () => {
  it("warns on the first consecutive zero-effect turn", () => {
    const decision = buildZeroEffectDecision({
      consecutiveTurns: ACTION_EFFECT.WARNING_THRESHOLD,
      warningThreshold: ACTION_EFFECT.WARNING_THRESHOLD,
      escalateThreshold: ACTION_EFFECT.ESCALATE_THRESHOLD,
    });

    expect(decision.kind).toBe("warn");
    expect(decision.message).toContain("last action had no observable effect");
  });

  it("escalates on the second consecutive zero-effect turn", () => {
    const decision = buildZeroEffectDecision({
      consecutiveTurns: ACTION_EFFECT.ESCALATE_THRESHOLD,
      warningThreshold: ACTION_EFFECT.WARNING_THRESHOLD,
      escalateThreshold: ACTION_EFFECT.ESCALATE_THRESHOLD,
    });

    expect(decision.kind).toBe("escalate");
    expect(decision.message).toContain("Escalate or replan now");
  });

  it("includes the failure brief when one is available", () => {
    const decision = buildZeroEffectDecision({
      consecutiveTurns: ACTION_EFFECT.ESCALATE_THRESHOLD,
      failureBrief: "- click [12] Save\n- read_page()",
      warningThreshold: ACTION_EFFECT.WARNING_THRESHOLD,
      escalateThreshold: ACTION_EFFECT.ESCALATE_THRESHOLD,
    });

    expect(decision.kind).toBe("escalate");
    expect(decision.message).toContain("- click [12] Save");
    expect(decision.message).toContain("- read_page()");
  });
});

describe("assessFailedActionRepeat", () => {
  it("allows actions with no prior matching failure", () => {
    expect(
      assessFailedActionRepeat({
        blockedActions: [
          {
            tool: "click_element",
            argsKey: '{"id":1}',
            error: "Click failed",
            turn: 3,
          },
        ],
        tool: "click_element",
        argsKey: '{"id":2}',
      }),
    ).toBeNull();
  });

  it("blocks exact repeats of prior failed actions", () => {
    const decision = assessFailedActionRepeat({
      blockedActions: [
        {
          tool: "click_element",
          argsKey: '{"id":1}',
          error: "No element with tag 1",
          turn: 3,
        },
      ],
      tool: "click_element",
      argsKey: '{"id":1}',
    });

    expect(decision).toEqual({
      priorTurn: 3,
      message:
        "Error: This exact action already failed at turn 3 with: 'No element with tag 1'. " +
        "Suggestions: read_page to refresh element IDs, or find_element to locate by text.",
    });
  });
});

describe("assessElementIdPreDispatch", () => {
  const snapshot = {
    url: "https://example.com",
    elements: [
      {
        tag: 1,
        tagName: "button",
        text: "Save",
      },
    ],
  } as any;

  it("allows valid current element ids", () => {
    expect(
      assessElementIdPreDispatch({
        toolName: ToolName.CLICK_ELEMENT,
        args: { id: 1 },
        snapshot,
        currentUrl: "https://example.com",
      }),
    ).toEqual({
      error: null,
      logArgs: '{"id":1}',
      traceData: null,
    });
  });

  it("blocks invalid ids and builds grounding trace data", () => {
    const decision = assessElementIdPreDispatch({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 99 },
      snapshot,
      currentUrl: "https://example.com",
    });

    expect(decision.error).toContain("Element id=99 does not exist");
    expect(decision.logArgs).toBe('{"id":99}');
    expect(decision.traceData).toEqual({
      toolName: ToolName.CLICK_ELEMENT,
      requestedId: 99,
      currentUrl: "https://example.com",
      reason: "invalid_element_id_pre_dispatch",
    });
  });

  it("uses sourceId or targetId for dual-id trace data", () => {
    const decision = assessElementIdPreDispatch({
      toolName: ToolName.DRAG_AND_DROP,
      args: { sourceId: 12, targetId: 13 },
      snapshot,
      currentUrl: "https://example.com",
    });

    expect(decision.error).toContain("Element sourceId=12 does not exist");
    expect(decision.traceData).toEqual({
      toolName: ToolName.DRAG_AND_DROP,
      requestedId: 12,
      currentUrl: "https://example.com",
      reason: "invalid_element_id_pre_dispatch",
    });
  });
});

describe("assessPreflightElement", () => {
  it("returns no issue for non-preflight tools", () => {
    expect(
      assessPreflightElement({
        toolName: ToolName.READ_PAGE,
        args: {},
        snapshot: null,
      }),
    ).toEqual({
      error: null,
      warning: null,
    });
  });

  it("blocks disabled target elements", () => {
    expect(
      assessPreflightElement({
        toolName: ToolName.CLICK_ELEMENT,
        args: { id: 1 },
        snapshot: {
          elements: [
            {
              tag: 1,
              isDisabled: true,
              rect: { width: 10, height: 10 },
              isVisible: true,
            },
          ],
        } as any,
      }),
    ).toEqual({
      error:
        "Error: Element [1] (id) is disabled and cannot be interacted with. Find an alternative or wait for it to become enabled.",
      warning: null,
    });
  });

  it("warns for invisible target elements without blocking", () => {
    expect(
      assessPreflightElement({
        toolName: ToolName.CLICK_ELEMENT,
        args: { id: 1 },
        snapshot: {
          elements: [
            {
              tag: 1,
              isDisabled: false,
              rect: { width: 10, height: 10 },
              isVisible: false,
            },
          ],
        } as any,
      }),
    ).toEqual({
      error: null,
      warning:
        "Warning: Element [1] (id) is not visible in the viewport. Consider scrolling to it first, or it may be hidden.",
    });
  });
});

describe("assessReadElementSameIdNudge", () => {
  it("resets state for non-read_element tools", () => {
    expect(
      assessReadElementSameIdNudge({
        toolName: ToolName.CLICK_ELEMENT,
        args: { id: 1 },
        state: {
          lastReadElementId: 1,
          consecutiveReadElementSameId: 2,
        },
      }),
    ).toEqual({
      state: {
        lastReadElementId: null,
        consecutiveReadElementSameId: 0,
      },
      nudge: null,
    });
  });

  it("tracks a new read_element id without nudging", () => {
    expect(
      assessReadElementSameIdNudge({
        toolName: ToolName.READ_ELEMENT,
        args: { id: 2 },
        state: {
          lastReadElementId: 1,
          consecutiveReadElementSameId: 1,
        },
      }),
    ).toEqual({
      state: {
        lastReadElementId: 2,
        consecutiveReadElementSameId: 0,
      },
      nudge: null,
    });
  });

  it("allows the second read_element for the same id without nudging", () => {
    const decision = assessReadElementSameIdNudge({
      toolName: ToolName.READ_ELEMENT,
      args: { id: 7 },
      state: {
        lastReadElementId: 7,
        consecutiveReadElementSameId: 0,
      },
    });

    expect(decision).toEqual({
      state: {
        lastReadElementId: 7,
        consecutiveReadElementSameId: 1,
      },
      nudge: null,
    });
  });

  it("nudges on the third read_element for the same id", () => {
    expect(
      assessReadElementSameIdNudge({
        toolName: ToolName.READ_ELEMENT,
        args: { id: 7 },
        state: {
          lastReadElementId: 7,
          consecutiveReadElementSameId: 1,
        },
      }),
    ).toEqual({
      state: {
        lastReadElementId: 7,
        consecutiveReadElementSameId: 2,
      },
      nudge: {
        elementId: 7,
        consecutive: 3,
        message:
          "You have called read_element on element [7] 3 times. " +
          "Try a different approach: click_element to interact with it, read_page for full page context, or find_element to locate a different target.",
      },
    });
  });
});

describe("assessToolCacheHit", () => {
  it("returns no cache type for non-cacheable tools", () => {
    const toolCache = new ToolResultCache();

    expect(
      assessToolCacheHit({
        toolName: ToolName.CLICK_ELEMENT,
        args: { id: 1 },
        snapshot: null,
        toolCache,
      }),
    ).toEqual({
      cacheType: undefined,
      cachedResult: null,
    });
  });

  it("returns cache type and null result for cacheable misses", () => {
    const toolCache = new ToolResultCache();

    expect(
      assessToolCacheHit({
        toolName: ToolName.READ_PAGE,
        args: {},
        snapshot: null,
        toolCache,
      }),
    ).toEqual({
      cacheType: "dom",
      cachedResult: null,
    });
  });

  it("returns cached result for cacheable hits", () => {
    const toolCache = new ToolResultCache();
    toolCache.set(
      ToolResultCache.key(ToolName.GET_COOKIES, {}),
      "cached cookies",
      "",
      "static",
    );

    expect(
      assessToolCacheHit({
        toolName: ToolName.GET_COOKIES,
        args: {},
        snapshot: null,
        toolCache,
      }),
    ).toEqual({
      cacheType: "static",
      cachedResult: "cached cookies",
    });
  });
});

describe("assessRedundantSuccessBlock", () => {
  it("allows matching successes below the block threshold", () => {
    expect(
      assessRedundantSuccessBlock({
        recentSuccesses: [
          {
            tool: ToolName.CLICK_ELEMENT,
            args: '{"id":1}',
            result: "clicked",
            snapshotFingerprint: "none|0|0",
          },
        ],
        toolName: ToolName.CLICK_ELEMENT,
        argsKey: '{"id":1}',
        snapshot: null,
        blockThreshold: 2,
      }),
    ).toBeNull();
  });

  it("blocks at the threshold and returns the last matching result", () => {
    expect(
      assessRedundantSuccessBlock({
        recentSuccesses: [
          {
            tool: ToolName.CLICK_ELEMENT,
            args: '{"id":1}',
            result: "first result",
            snapshotFingerprint: "none|0|0",
          },
          {
            tool: ToolName.CLICK_ELEMENT,
            args: '{"id":1}',
            result: "last result",
            snapshotFingerprint: "none|0|0",
          },
        ],
        toolName: ToolName.CLICK_ELEMENT,
        argsKey: '{"id":1}',
        snapshot: null,
        blockThreshold: 2,
      }),
    ).toEqual({
      count: 2,
      result: "last result",
    });
  });

  it("does not block matches from a different snapshot fingerprint", () => {
    expect(
      assessRedundantSuccessBlock({
        recentSuccesses: [
          {
            tool: ToolName.CLICK_ELEMENT,
            args: '{"id":1}',
            result: "clicked",
            snapshotFingerprint: "other",
          },
          {
            tool: ToolName.CLICK_ELEMENT,
            args: '{"id":1}',
            result: "clicked again",
            snapshotFingerprint: "other",
          },
        ],
        toolName: ToolName.CLICK_ELEMENT,
        argsKey: '{"id":1}',
        snapshot: null,
        blockThreshold: 2,
      }),
    ).toBeNull();
  });
});
