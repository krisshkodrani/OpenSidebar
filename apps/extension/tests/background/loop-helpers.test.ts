import { describe, expect, it } from "vitest";

import { ACTION_EFFECT } from "../../src/background/agent/constants";
import {
  assessElementIdPreDispatch,
  assessDeadEndPattern,
  assessFailedActionRepeat,
  assessPreflightElement,
  assessRedundantSuccessBlock,
  assessReadElementSameIdNudge,
  assessSamePageAnchorClick,
  assessSameUrlForcedEscalation,
  assessToolCacheHit,
  assessStepDurationWatchdog,
  buildSubgoalAttempt,
  buildZeroEffectDecision,
  countTrailingToolResultOutcomes,
  extractDiscoveredTagIds,
  normalizeOutcome,
  recordRecentSuccessfulAction,
  recordRecentOutcome,
  updateConsecutiveAllFailTurns,
  updateExplorationBudget,
  updatePostEscalationPivot,
  updateSameToolFailureTracking,
} from "../../src/background/agent/loop-helpers";
import { ToolResultCache } from "../../src/background/agent/tool-cache";
import { ToolName } from "../../src/types";

describe("extractDiscoveredTagIds", () => {
  it("does not treat successful click target ids as reusable discoveries", () => {
    expect(
      extractDiscoveredTagIds(
        ToolName.CLICK_ELEMENT,
        'Clicked [42] button "Add experience"',
      ),
    ).toEqual([]);
  });

  it("keeps blocker ids from click failures for recovery", () => {
    expect(
      extractDiscoveredTagIds(
        ToolName.CLICK_ELEMENT,
        'Click intercepted: target [42] is covered by [99] <div>',
      ),
    ).toEqual([42, 99]);
  });
});

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

describe("assessSamePageAnchorClick", () => {
  const snapshot = {
    elements: [
      {
        tag: 9,
        tagName: "a",
        role: "link",
        text: "Form",
        attributes: { href: "/form" },
        rect: { width: 60, height: 24 },
        isVisible: true,
        isDisabled: false,
      },
      {
        tag: 10,
        tagName: "a",
        role: "link",
        text: "Shop",
        attributes: { href: "/shop" },
        rect: { width: 60, height: 24 },
        isVisible: true,
        isDisabled: false,
      },
      {
        tag: 11,
        tagName: "a",
        role: "link",
        text: "Details",
        attributes: { href: "#details" },
        rect: { width: 60, height: 24 },
        isVisible: true,
        isDisabled: false,
      },
      {
        tag: 12,
        tagName: "button",
        role: "button",
        text: "Submit",
        attributes: {},
        rect: { width: 60, height: 24 },
        isVisible: true,
        isDisabled: false,
      },
      {
        tag: 13,
        tagName: "a",
        role: "link",
        text: "Placeholder",
        attributes: { href: "#" },
        rect: { width: 60, height: 24 },
        isVisible: true,
        isDisabled: false,
      },
      {
        tag: 14,
        tagName: "a",
        role: "button",
        text: "Toggle details",
        attributes: { href: "#" },
        rect: { width: 60, height: 24 },
        isVisible: true,
        isDisabled: false,
      },
    ],
  } as any;

  it("blocks click_element on an anchor that resolves to the current page", () => {
    const decision = assessSamePageAnchorClick({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 9 },
      snapshot,
      currentUrl: "http://127.0.0.1:50813/form",
    });

    expect(decision).toEqual({
      error: expect.stringContaining("link to the current page"),
      targetUrl: "http://127.0.0.1:50813/form",
    });
    expect(decision.error).toContain("discard in-progress state");
  });

  it("allows anchors that navigate to another route", () => {
    expect(
      assessSamePageAnchorClick({
        toolName: ToolName.CLICK_ELEMENT,
        args: { id: 10 },
        snapshot,
        currentUrl: "http://127.0.0.1:50813/form",
      }),
    ).toEqual({ error: null, targetUrl: null });
  });

  it("allows in-page hash anchors", () => {
    expect(
      assessSamePageAnchorClick({
        toolName: ToolName.CLICK_ELEMENT,
        args: { id: 11 },
        snapshot,
        currentUrl: "http://127.0.0.1:50813/form",
      }),
    ).toEqual({ error: null, targetUrl: null });
  });

  it("blocks placeholder hash links that only resolve to the current page", () => {
    const decision = assessSamePageAnchorClick({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 13 },
      snapshot,
      currentUrl: "http://127.0.0.1:50813/form",
    });

    expect(decision).toEqual({
      error: expect.stringContaining("link to the current page"),
      targetUrl: "http://127.0.0.1:50813/form#",
    });
  });

  it("allows placeholder hash anchors that are exposed as buttons", () => {
    expect(
      assessSamePageAnchorClick({
        toolName: ToolName.CLICK_ELEMENT,
        args: { id: 14 },
        snapshot,
        currentUrl: "http://127.0.0.1:50813/form",
      }),
    ).toEqual({ error: null, targetUrl: null });
  });

  it("ignores non-anchor elements", () => {
    expect(
      assessSamePageAnchorClick({
        toolName: ToolName.CLICK_ELEMENT,
        args: { id: 12 },
        snapshot,
        currentUrl: "http://127.0.0.1:50813/form",
      }),
    ).toEqual({ error: null, targetUrl: null });
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

describe("recordRecentSuccessfulAction", () => {
  it("records successes and returns no decision below thresholds", () => {
    const recentSuccesses = [];

    expect(
      recordRecentSuccessfulAction({
        recentSuccesses,
        toolName: ToolName.CLICK_ELEMENT,
        argsKey: '{"id":1}',
        resultContent: "Clicked",
        snapshot: null,
        windowSize: 3,
        infoThreshold: 2,
        toolNameInfoThreshold: 3,
      }),
    ).toEqual({ kind: "none" });
    expect(recentSuccesses).toHaveLength(1);
  });

  it("returns a redundant nudge and clears the buffer at the same-state threshold", () => {
    const recentSuccesses = [
      {
        tool: ToolName.CLICK_ELEMENT,
        args: '{"id":1}',
        result: "Clicked",
        snapshotFingerprint: "none|0|0",
      },
    ];

    expect(
      recordRecentSuccessfulAction({
        recentSuccesses,
        toolName: ToolName.CLICK_ELEMENT,
        argsKey: '{"id":1}',
        resultContent: "Clicked again",
        snapshot: null,
        windowSize: 3,
        infoThreshold: 2,
        toolNameInfoThreshold: 3,
      }),
    ).toEqual(
      expect.objectContaining({
        kind: "redundant_nudge",
        sameStateCount: 2,
        totalRepeatCount: 2,
      }),
    );
    expect(recentSuccesses).toHaveLength(0);
  });

  it("does not record failed-looking results", () => {
    const recentSuccesses = [];

    expect(
      recordRecentSuccessfulAction({
        recentSuccesses,
        toolName: ToolName.CLICK_ELEMENT,
        argsKey: '{"id":1}',
        resultContent: "Error: failed",
        snapshot: null,
        windowSize: 3,
        infoThreshold: 2,
        toolNameInfoThreshold: 3,
      }),
    ).toEqual({ kind: "none" });
    expect(recentSuccesses).toHaveLength(0);
  });
});

describe("tool result turn failure tracking", () => {
  it("counts only trailing tool result messages", () => {
    expect(
      countTrailingToolResultOutcomes([
        { role: "tool", content: "old success" },
        { role: "assistant", content: "next turn" },
        { role: "tool", content: "Error: first failure" },
        { role: "tool", content: "Clicked" },
        { role: "tool", content: "No element with tag 7" },
      ]),
    ).toEqual({
      turnSuccesses: 1,
      turnFailures: 2,
    });
  });

  it("increments consecutive all-fail turns only when the turn has failures and no successes", () => {
    expect(
      updateConsecutiveAllFailTurns({
        previousCount: 2,
        turnSuccesses: 0,
        turnFailures: 1,
      }),
    ).toBe(3);
    expect(
      updateConsecutiveAllFailTurns({
        previousCount: 2,
        turnSuccesses: 1,
        turnFailures: 1,
      }),
    ).toBe(0);
    expect(
      updateConsecutiveAllFailTurns({
        previousCount: 2,
        turnSuccesses: 0,
        turnFailures: 0,
      }),
    ).toBe(0);
  });
});

describe("updateSameToolFailureTracking", () => {
  it("records failed actions and returns a warning at the warning threshold", () => {
    const blockedActions = [];
    const toolFailCounts = new Map<string, number>();

    const first = updateSameToolFailureTracking({
      blockedActions,
      toolFailCounts,
      toolName: ToolName.CLICK_ELEMENT,
      argsKey: '{"id":7}',
      resultContent: "Error: covered by overlay",
      turn: 3,
      bufferSize: 3,
      warnThreshold: 2,
      exitThreshold: 4,
    });
    const second = updateSameToolFailureTracking({
      blockedActions,
      toolFailCounts,
      toolName: ToolName.CLICK_ELEMENT,
      argsKey: '{"id":7}',
      resultContent: "Error: covered by overlay",
      turn: 4,
      bufferSize: 3,
      warnThreshold: 2,
      exitThreshold: 4,
    });

    expect(first).toEqual({ kind: "none", count: 1 });
    expect(second).toEqual(
      expect.objectContaining({ kind: "warn", count: 2 }),
    );
    expect(blockedActions).toHaveLength(2);
    expect(toolFailCounts.get('click_element:{"id":7}')).toBe(2);
  });

  it("returns exit at the exit threshold", () => {
    const blockedActions = [];
    const toolFailCounts = new Map<string, number>([
      ['click_element:{"id":7}', 2],
    ]);

    expect(
      updateSameToolFailureTracking({
        blockedActions,
        toolFailCounts,
        toolName: ToolName.CLICK_ELEMENT,
        argsKey: '{"id":7}',
        resultContent: "Click intercepted",
        turn: 5,
        bufferSize: 3,
        warnThreshold: 2,
        exitThreshold: 3,
      }),
    ).toEqual(expect.objectContaining({ kind: "exit", count: 3 }));
  });

  it("resets the repeated failure count on success", () => {
    const blockedActions = [];
    const toolFailCounts = new Map<string, number>([
      ['click_element:{"id":7}', 2],
    ]);

    expect(
      updateSameToolFailureTracking({
        blockedActions,
        toolFailCounts,
        toolName: ToolName.CLICK_ELEMENT,
        argsKey: '{"id":7}',
        resultContent: "Clicked",
        turn: 5,
        bufferSize: 3,
        warnThreshold: 2,
        exitThreshold: 3,
      }),
    ).toEqual({ kind: "none", count: 0 });
    expect(toolFailCounts.has('click_element:{"id":7}')).toBe(false);
    expect(blockedActions).toHaveLength(0);
  });
});

describe("updateExplorationBudget", () => {
  const explorationOnlyTools = new Set<string>([
    ToolName.READ_PAGE,
    ToolName.FIND_ELEMENT,
  ]);

  it("increments discovery-only turns without nudging below threshold", () => {
    expect(
      updateExplorationBudget({
        previousCount: 1,
        toolNames: [ToolName.READ_PAGE, ToolName.FIND_ELEMENT],
        explorationOnlyTools,
        maxConsecutive: 3,
      }),
    ).toEqual({
      consecutiveTurns: 2,
      message: null,
    });
  });

  it("returns a nudge at the exploration threshold", () => {
    const decision = updateExplorationBudget({
      previousCount: 2,
      toolNames: [ToolName.READ_PAGE],
      explorationOnlyTools,
      maxConsecutive: 3,
    });

    expect(decision.consecutiveTurns).toBe(3);
    expect(decision.message).toContain("only reading/inspecting");
  });

  it("resets when the turn includes an action tool", () => {
    expect(
      updateExplorationBudget({
        previousCount: 2,
        toolNames: [ToolName.CLICK_ELEMENT],
        explorationOnlyTools,
        maxConsecutive: 3,
      }),
    ).toEqual({
      consecutiveTurns: 0,
      message: null,
    });
  });
});

describe("dead-end outcome tracking", () => {
  it("records normalized outcomes and caps the window", () => {
    const recentOutcomes = [];

    recordRecentOutcome({
      recentOutcomes,
      resultContent: "No element with tag [12]",
      snapshotFp: "page-a",
      windowSize: 2,
    });
    recordRecentOutcome({
      recentOutcomes,
      resultContent: "No element with tag [13]",
      snapshotFp: "page-a",
      windowSize: 2,
    });
    recordRecentOutcome({
      recentOutcomes,
      resultContent: "Clicked [7]",
      snapshotFp: "page-a",
      windowSize: 2,
    });

    expect(recentOutcomes).toHaveLength(2);
    expect(recentOutcomes[0]).toEqual({
      fingerprint: normalizeOutcome("No element with tag [13]"),
      snapshotFp: "page-a",
    });
  });

  it("returns a nudge when repeated outcomes hit the reflection threshold", () => {
    expect(
      assessDeadEndPattern({
        recentOutcomes: [
          { fingerprint: "same", snapshotFp: "page-a" },
          { fingerprint: "same", snapshotFp: "page-a" },
          { fingerprint: "same", snapshotFp: "page-a" },
        ],
        reflectionThreshold: 3,
        pivotThreshold: 4,
      }),
    ).toEqual(
      expect.objectContaining({
        kind: "nudge",
        pattern: "same",
        count: 3,
      }),
    );
  });

  it("returns a pivot when repeated outcomes hit the pivot threshold", () => {
    expect(
      assessDeadEndPattern({
        recentOutcomes: [
          { fingerprint: "same", snapshotFp: "page-a" },
          { fingerprint: "same", snapshotFp: "page-a" },
          { fingerprint: "same", snapshotFp: "page-a" },
          { fingerprint: "same", snapshotFp: "page-a" },
        ],
        reflectionThreshold: 3,
        pivotThreshold: 4,
      }),
    ).toEqual({
      kind: "pivot",
      pattern: "same",
      count: 4,
    });
  });

  it("does not trigger for the same outcome on a changed snapshot", () => {
    expect(
      assessDeadEndPattern({
        recentOutcomes: [
          { fingerprint: "same", snapshotFp: "page-a" },
          { fingerprint: "same", snapshotFp: "page-a" },
          { fingerprint: "same", snapshotFp: "page-b" },
        ],
        reflectionThreshold: 3,
        pivotThreshold: 4,
      }),
    ).toEqual({ kind: "none" });
  });

  it("does not treat distinct successful checkbox mutations as a dead end", () => {
    const recentOutcomes = [];
    recordRecentOutcome({
      recentOutcomes,
      resultContent: 'Set [158] <input> "answer" checked=true',
      snapshotFp: "quiz-page",
      windowSize: 4,
    });
    recordRecentOutcome({
      recentOutcomes,
      resultContent: 'Set [159] <input> "answer" checked=true',
      snapshotFp: "quiz-page",
      windowSize: 4,
    });

    expect(
      assessDeadEndPattern({
        recentOutcomes,
        reflectionThreshold: 2,
        pivotThreshold: 4,
      }),
    ).toEqual({ kind: "none" });
  });

  it("still normalizes different failed element ids for recovery detection", () => {
    const recentOutcomes = [];
    recordRecentOutcome({
      recentOutcomes,
      resultContent: "No element with tag [12]",
      snapshotFp: "page-a",
      windowSize: 4,
    });
    recordRecentOutcome({
      recentOutcomes,
      resultContent: "No element with tag [13]",
      snapshotFp: "page-a",
      windowSize: 4,
    });

    expect(
      assessDeadEndPattern({
        recentOutcomes,
        reflectionThreshold: 2,
        pivotThreshold: 4,
      }),
    ).toEqual(expect.objectContaining({ kind: "nudge", count: 2 }));
  });
});

describe("updatePostEscalationPivot", () => {
  it("stays inactive when no step escalation is active", () => {
    expect(
      updatePostEscalationPivot({
        turnsSinceStepEscalation: -1,
        pivotTurns: 3,
      }),
    ).toEqual({
      kind: "none",
      turnsSinceStepEscalation: -1,
    });
  });

  it("increments without pivoting below the threshold", () => {
    expect(
      updatePostEscalationPivot({
        turnsSinceStepEscalation: 1,
        pivotTurns: 3,
      }),
    ).toEqual({
      kind: "none",
      turnsSinceStepEscalation: 2,
    });
  });

  it("requests a pivot at the threshold", () => {
    expect(
      updatePostEscalationPivot({
        turnsSinceStepEscalation: 2,
        pivotTurns: 3,
      }),
    ).toEqual({
      kind: "pivot",
      turnsSinceStepEscalation: 3,
    });
  });
});

describe("assessStepDurationWatchdog", () => {
  const base = {
    hasTaskId: true,
    planSubtaskCount: 1,
    turnsOnCurrentStep: 1,
    escalationTier: 0,
    cooldownRemaining: 0,
    warnTurns: 3,
    escalateTurns: 5,
  };

  it("stays inactive without an active planned task", () => {
    expect(
      assessStepDurationWatchdog({
        ...base,
        hasTaskId: false,
      }),
    ).toEqual({ kind: "none" });
    expect(
      assessStepDurationWatchdog({
        ...base,
        planSubtaskCount: 0,
      }),
    ).toEqual({ kind: "none" });
  });

  it("warns at the warn threshold", () => {
    expect(
      assessStepDurationWatchdog({
        ...base,
        turnsOnCurrentStep: 3,
      }),
    ).toEqual({ kind: "warn" });
  });

  it("escalates at the escalation threshold when tier and cooldown allow", () => {
    expect(
      assessStepDurationWatchdog({
        ...base,
        turnsOnCurrentStep: 5,
      }),
    ).toEqual({ kind: "escalate" });
  });

  it("does not escalate while already escalated or cooling down", () => {
    expect(
      assessStepDurationWatchdog({
        ...base,
        turnsOnCurrentStep: 5,
        escalationTier: 1,
      }),
    ).toEqual({ kind: "none" });
    expect(
      assessStepDurationWatchdog({
        ...base,
        turnsOnCurrentStep: 5,
        cooldownRemaining: 1,
      }),
    ).toEqual({ kind: "none" });
  });
});

describe("assessSameUrlForcedEscalation", () => {
  it("escalates when same-url turns reach the threshold", () => {
    expect(
      assessSameUrlForcedEscalation({
        escalationTier: 0,
        cooldownRemaining: 0,
        sameUrlTurns: 5,
        sameUrlEscalate: 5,
      }),
    ).toEqual({ kind: "escalate" });
  });

  it("does not escalate below threshold, while escalated, or during cooldown", () => {
    expect(
      assessSameUrlForcedEscalation({
        escalationTier: 0,
        cooldownRemaining: 0,
        sameUrlTurns: 4,
        sameUrlEscalate: 5,
      }),
    ).toEqual({ kind: "none" });
    expect(
      assessSameUrlForcedEscalation({
        escalationTier: 1,
        cooldownRemaining: 0,
        sameUrlTurns: 5,
        sameUrlEscalate: 5,
      }),
    ).toEqual({ kind: "none" });
    expect(
      assessSameUrlForcedEscalation({
        escalationTier: 0,
        cooldownRemaining: 1,
        sameUrlTurns: 5,
        sameUrlEscalate: 5,
      }),
    ).toEqual({ kind: "none" });
  });
});

describe("buildSubgoalAttempt", () => {
  it("formats successful tool attempts for failure brief tracking", () => {
    expect(
      buildSubgoalAttempt({
        turn: 7,
        toolName: "click_element",
        toolArguments: '{"id":123,"extra":"long"}',
        resultContent: "Clicked [123]\nExtra detail",
        snapshotFp: "page-a",
      }),
    ).toEqual({
      turn: 7,
      tool: "click_element",
      args: '{"id":123,"extra":"long"}',
      outcome: "Clicked [123]",
      wasFailure: false,
      snapshotFp: "page-a",
    });
  });

  it("marks failed-looking outcomes as failures and truncates args/outcome", () => {
    const longArgs = `{"id":${"1".repeat(140)}}`;
    const longResult = `Error: ${"x".repeat(160)}\nMore detail`;

    const attempt = buildSubgoalAttempt({
      turn: 8,
      toolName: "click_element",
      toolArguments: longArgs,
      resultContent: longResult,
      snapshotFp: "page-b",
    });

    expect(attempt.wasFailure).toBe(true);
    expect(attempt.args).toHaveLength(100);
    expect(attempt.outcome).toHaveLength(120);
  });

  it("falls back to empty args for non-string tool arguments", () => {
    const attempt = buildSubgoalAttempt({
      turn: 9,
      toolName: "click_element",
      toolArguments: { id: 123 },
      resultContent: "Clicked [123]",
      snapshotFp: "page-c",
    });

    expect(attempt.args).toBe("");
  });
});
