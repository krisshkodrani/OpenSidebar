/**
 * Page-content emission policy (LP-17 Phase 2).
 *
 * Live traces (docs/engineering/token-and-planner-analysis-2026-07-18.md)
 * showed the Page Content block byte-identical across all 53 turns of a
 * form-fill run yet re-sent — and re-billed — every turn (~7% of the run's
 * input tokens). This policy replaces an unchanged block with a short,
 * truthful marker plus a grounding excerpt.
 *
 * Because inference is stateless and old turns are compressed away, elided
 * text would otherwise be GONE from context — so the full block is re-emitted
 * on the first turn, on any change or navigation, and on a fixed cadence.
 * The marker text is byte-stable between re-emits (its turn numbers freeze at
 * the change/full-emit turns) so it never churns the prompt itself.
 */

import { djb2 } from "./loop-helpers";

export interface PageContentEmissionState {
  /** djb2 of the last emitted-in-full (post-truncation) block. */
  lastHash: number | null;
  lastUrl: string | null;
  /** Turn on which the current hash first appeared. */
  stableSinceTurn: number | null;
  lastFullEmitTurn: number | null;
}

export function createPageContentEmissionState(): PageContentEmissionState {
  return {
    lastHash: null,
    lastUrl: null,
    stableSinceTurn: null,
    lastFullEmitTurn: null,
  };
}

/** Re-ground with the full block at least this often even when unchanged. */
export const PAGE_CONTENT_REEMIT_INTERVAL = 5;
/** Grounding excerpt length carried by the marker. */
const MARKER_EXCERPT_CHARS = 600;

export interface PageContentEmission {
  mode: "full" | "marker";
  block: string;
  nextState: PageContentEmissionState;
}

export function decidePageContentEmission(params: {
  /** The already-truncated/compressed content block that WOULD be emitted. */
  fullBlock: string;
  state: PageContentEmissionState;
  turn: number;
  url: string;
  isFirstTurn: boolean;
}): PageContentEmission {
  const { fullBlock, state, turn, url, isFirstTurn } = params;
  const hash = djb2(fullBlock);

  const changed = state.lastHash === null || hash !== state.lastHash;
  const navigated = state.lastUrl !== null && url !== state.lastUrl;
  const cadenceDue =
    state.lastFullEmitTurn === null ||
    turn - state.lastFullEmitTurn >= PAGE_CONTENT_REEMIT_INTERVAL;
  // getPrompt can run more than once within a turn (retries, re-estimation):
  // a turn that emitted in full keeps emitting in full for its duration.
  const sameTurnRepeat = state.lastFullEmitTurn === turn;

  if (isFirstTurn || changed || navigated || cadenceDue || sameTurnRepeat) {
    return {
      mode: "full",
      block: fullBlock,
      nextState: {
        lastHash: hash,
        lastUrl: url,
        stableSinceTurn: changed || navigated ? turn : state.stableSinceTurn,
        lastFullEmitTurn: turn,
      },
    };
  }

  const excerpt =
    fullBlock.length > MARKER_EXCERPT_CHARS
      ? fullBlock.slice(0, MARKER_EXCERPT_CHARS) + "…"
      : fullBlock;
  const block =
    `«Page Content unchanged since turn ${state.stableSinceTurn} ` +
    `(last shown in full on turn ${state.lastFullEmitTurn}).»\n` +
    `Excerpt: ${excerpt}\n` +
    `[The rest is identical to what you already acted on; call read_page ` +
    `only for full-text extraction tasks.]`;

  return {
    mode: "marker",
    block,
    // State unchanged — keeps the marker byte-stable until the next full emit.
    nextState: state,
  };
}
