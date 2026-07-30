/**
 * Trajectory rendering for the benchmark judge (RFC LP-1).
 *
 * WebJudge is told that "a confident-sounding final answer with no supporting
 * trajectory evidence is a failure". That rule is correct and must stay — so
 * whatever evidence the run actually recorded has to reach the judge, or the
 * judge fails honest runs for a defect in this file.
 *
 * The original renderer dropped three kinds of evidence (found 2026-07-26 when
 * a correct Hacker News answer scored as a failure):
 *   1. tool RESULTS were never emitted — the judge saw `read_element(id=206)`
 *      but never what the page returned, so no observation was ever visible;
 *   2. the model's own narration was emitted only on turns with NO tool call,
 *      so it vanished on exactly the turns that did something;
 *   3. tool args were clipped to 40 chars, cutting `done(summary=…)` — the
 *      final answer — off mid-sentence.
 *
 * Extracted from the bench runner so the renderer is unit-testable and can be
 * replayed over existing receipts (`--judge-only`) without paying for browser
 * time again.
 *
 * One line per event, because the judge prompt caps the trajectory by LINE
 * count; multi-line entries would blow that budget on long runs.
 */

/** Structural view of a trace turn — mirrors `TraceTurn` in the e2e helpers. */
export interface TrajectoryTurn {
  turnNumber: number;
  llmContent?: string;
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
  toolResults?: Array<{
    name: string;
    success: boolean;
    result: string;
    error?: string;
  }>;
  url?: string;
  /** Visible tagged-element text the harness recorded for this turn. */
  observedText?: string[];
}

const ARG_CHAR_LIMIT = 200;
const RESULT_CHAR_LIMIT = 220;
const NARRATION_CHAR_LIMIT = 240;
/**
 * Perception digest budget. Emitted ONLY on turns with no tool result, so the
 * prompt grows just for the turns that would otherwise carry no evidence at
 * all. The cap is a real limitation: on a long page the relevant text can fall
 * outside it, which shows up as an "uncertain"/failure verdict rather than a
 * wrong pass — the safe direction for a published number.
 */
const OBSERVED_ITEM_LIMIT = 60;
const OBSERVED_ITEM_CHAR_LIMIT = 80;

function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

function renderArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .filter(([, v]) => typeof v === "string" || typeof v === "number")
    .map(([k, v]) => `${k}=${clip(String(v), ARG_CHAR_LIMIT)}`)
    .join(", ");
}

/**
 * Render trace turns into the judge's one-line-per-event trajectory.
 *
 * Ordering within a turn is narration -> tool call -> tool result, so the judge
 * reads what the agent saw before what it concluded.
 */
export function buildTrajectory(turns: TrajectoryTurn[]): string[] {
  const lines: string[] = [];
  for (const turn of turns) {
    const at = turn.url ? ` @ ${turn.url}` : "";
    const tag = `T${turn.turnNumber}`;

    // Perception digest FIRST, and only when this turn recorded no tool result
    // — i.e. when the agent answered straight from what it saw. This is the
    // harness's own record of the page, so unlike the narration below it is
    // evidence the model cannot fabricate. Without it the judge's "no
    // supporting evidence is a failure" rule fails correct perception-only
    // answers; with narration alone it would instead be trusting the model's
    // own claim, which is how a confident hallucination gets a pass.
    if ((turn.toolResults ?? []).length === 0 && turn.observedText?.length) {
      const seen = turn.observedText
        .slice(0, OBSERVED_ITEM_LIMIT)
        .map((text) => clip(text, OBSERVED_ITEM_CHAR_LIMIT));
      const omitted = turn.observedText.length - seen.length;
      lines.push(
        `${tag}   saw (page text${omitted > 0 ? `, +${omitted} more` : ""}): ${seen.join(" | ")}`,
      );
    }

    // Narration is the model's OWN account, so it is labelled as such — the
    // judge must be able to tell it apart from the observed evidence above.
    // It is emitted even on turns that also called a tool, because the original
    // renderer dropped it on exactly those turns.
    if (turn.llmContent && turn.llmContent.trim()) {
      lines.push(
        `${tag} agent-claim "${clip(turn.llmContent, NARRATION_CHAR_LIMIT)}"`,
      );
    }

    for (const call of turn.toolCalls) {
      lines.push(`${tag} ${call.name}(${renderArgs(call.args)})${at}`);
    }

    // Tool results are the observation the judge's rule is actually asking for.
    for (const result of turn.toolResults ?? []) {
      const status = result.success ? "ok" : "ERROR";
      const body = result.error
        ? clip(result.error, RESULT_CHAR_LIMIT)
        : clip(result.result, RESULT_CHAR_LIMIT);
      lines.push(`${tag}   -> ${result.name} ${status}: ${body}`);
    }

    if (
      turn.toolCalls.length === 0 &&
      (turn.toolResults ?? []).length === 0 &&
      !turn.llmContent
    ) {
      lines.push(`${tag} (no action recorded)${at}`);
    }
  }
  return lines;
}
