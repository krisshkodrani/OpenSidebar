/**
 * Page-content emission policy (LP-17 Phase 2).
 *
 * Unchanged page text was measured at ~7% of a long run's input tokens
 * (byte-identical across 53 turns, re-sent every turn). These tests prove the
 * emission rules: full on first turn / change / navigation / cadence, a
 * byte-stable truthful marker otherwise.
 */
import { describe, expect, test } from "vitest";
import {
  createPageContentEmissionState,
  decidePageContentEmission,
  PAGE_CONTENT_REEMIT_INTERVAL,
} from "../../src/background/agent/page-content-policy";

const URL = "https://example.test/apply";
const CONTENT = "## Application\n" + "Lorem ipsum dolor sit amet. ".repeat(50);

function emitOnce(state = createPageContentEmissionState(), turn = 1, opts: {
  content?: string;
  url?: string;
  isFirstTurn?: boolean;
} = {}) {
  return decidePageContentEmission({
    fullBlock: opts.content ?? CONTENT,
    state,
    turn,
    url: opts.url ?? URL,
    isFirstTurn: opts.isFirstTurn ?? false,
  });
}

describe("decidePageContentEmission", () => {
  test("first turn always emits in full", () => {
    const emission = emitOnce(undefined, 1, { isFirstTurn: true });
    expect(emission.mode).toBe("full");
    expect(emission.block).toBe(CONTENT);
  });

  test("unchanged content on the next turn becomes a marker with an excerpt", () => {
    const first = emitOnce(undefined, 1, { isFirstTurn: true });
    const second = emitOnce(first.nextState, 2);
    expect(second.mode).toBe("marker");
    expect(second.block).toContain("«Page Content unchanged since turn 1");
    expect(second.block).toContain("last shown in full on turn 1");
    expect(second.block).toContain("Excerpt: ## Application");
    expect(second.block.length).toBeLessThan(CONTENT.length);
  });

  test("marker is byte-stable across turns (no prompt churn)", () => {
    const first = emitOnce(undefined, 1, { isFirstTurn: true });
    const second = emitOnce(first.nextState, 2);
    const third = emitOnce(second.nextState, 3);
    expect(third.block).toBe(second.block);
  });

  test("changed content re-emits in full and restarts the stability clock", () => {
    const first = emitOnce(undefined, 1, { isFirstTurn: true });
    const changed = emitOnce(first.nextState, 2, { content: CONTENT + " new" });
    expect(changed.mode).toBe("full");
    const marker = emitOnce(changed.nextState, 3, { content: CONTENT + " new" });
    expect(marker.block).toContain("unchanged since turn 2");
  });

  test("navigation re-emits in full", () => {
    const first = emitOnce(undefined, 1, { isFirstTurn: true });
    const navigated = emitOnce(first.nextState, 2, {
      url: "https://example.test/other",
    });
    expect(navigated.mode).toBe("full");
  });

  test("cadence re-grounds with the full block", () => {
    let state = emitOnce(undefined, 1, { isFirstTurn: true }).nextState;
    for (let turn = 2; turn < 1 + PAGE_CONTENT_REEMIT_INTERVAL; turn++) {
      const emission = emitOnce(state, turn);
      expect(emission.mode).toBe("marker");
      state = emission.nextState;
    }
    const cadence = emitOnce(state, 1 + PAGE_CONTENT_REEMIT_INTERVAL);
    expect(cadence.mode).toBe("full");
  });

  test("repeat calls within the same turn keep emitting full", () => {
    const first = emitOnce(undefined, 3, { isFirstTurn: false });
    expect(first.mode).toBe("full"); // null hash → full
    const repeat = emitOnce(first.nextState, 3);
    expect(repeat.mode).toBe("full");
  });

  test("short content is excerpted whole without ellipsis", () => {
    const short = "Tiny page.";
    const first = emitOnce(undefined, 1, { isFirstTurn: true, content: short });
    const marker = emitOnce(first.nextState, 2, { content: short });
    expect(marker.block).toContain("Excerpt: Tiny page.");
    expect(marker.block).not.toContain("Tiny page.…");
  });
});
