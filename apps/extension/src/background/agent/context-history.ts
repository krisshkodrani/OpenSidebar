/**
 * Append-only conversation history with an immutable summary chain
 * (RFC LP-21 §6 "P5", increment 2 — issue #103).
 *
 * ## The defect this replaces
 *
 * `ContextManager` kept one mutable `history` array that doubled as both the
 * record of the conversation and the thing sent to the model. Every compaction
 * path rewrote it in place:
 *
 *   - `rollingDistill` did `this.history = []` every 8 turns and regenerated a
 *     summary from scratch,
 *   - `compressHistoryByLevel` did the same at history lengths 20/40/70,
 *   - LIGHT/MEDIUM masking assigned `msg.content = ...` on already-sent messages.
 *
 * Prefix caching keeps only the bytes before the first CHANGED byte, so each of
 * these threw away the cached prefix from the earliest rewritten message
 * onward. Measured in the step-2 observation window: 266 of 271 warm turns
 * diverged with no compaction to justify it.
 *
 * ## The contract
 *
 * Bluebox's follow-up on #103 is precise about why a naive rolling summary is
 * not enough: if one summary object is re-folded on each pass, its bytes change
 * every time, and it sits EARLIER in the prompt than the fresh turns — so the
 * cache still breaks, just less often. What is required instead:
 *
 *   1. A message that has been sent is never mutated or replaced. Ever.
 *   2. Compaction APPENDS a new summary and marks the elided range inactive.
 *      The elided messages themselves are left alone.
 *   3. A summary, once written, is itself immutable. The next compaction
 *      summarises `previous summary + turns since` into a NEW summary appended
 *      after it — it does not rewrite the old one.
 *
 * The result is that the projection's prefix up to the last compaction point
 * never changes again, so it stays cached indefinitely, and each compaction is
 * one deliberate, observable cache reset rather than a recurring miss.
 *
 * ## Log vs projection
 *
 * The log is the durable, append-only record. The projection is what goes to
 * the model. Separating them is what makes rule 1 achievable: compaction now
 * changes only which slice of the log is projected, never the log's contents.
 * The full log is retained for checkpoint export and replay, which previously
 * lost information every time compaction ran.
 */

import type { LLMMessage } from "../llm/types";

/** How a summary came to be written, for `prompt_prefix_reset` telemetry. */
export type CompactionCause =
  | "rolling_distill"
  | "threshold_compaction"
  | "history_cap";

export interface CompactionRecord {
  cause: CompactionCause;
  /** Messages elided from the projection by this compaction. */
  elidedCount: number;
  /** Projection length before and after. */
  before: number;
  after: number;
}

/**
 * Builds the summary text for a compaction. Injected rather than imported so
 * this module stays pure and the caller keeps ownership of prompt wording.
 *
 * Receives the previous summary (or null on the first compaction) plus the
 * messages being elided, and returns the new summary's content — implementing
 * rule 3's "summarise summary N + turns since" without this module needing to
 * know the format.
 */
export type SummaryBuilder = (
  previousSummary: LLMMessage | null,
  elided: readonly LLMMessage[],
) => string | null;

export class HistoryLog {
  /**
   * Every message ever added, in order. APPEND-ONLY: entries are never
   * reassigned, mutated, or spliced. Compaction moves `activeFrom` instead.
   */
  private readonly entries: LLMMessage[] = [];

  /**
   * Index of the first entry still projected to the model. Everything before it
   * is represented by the summary chain.
   */
  private activeFrom = 0;

  /**
   * Immutable summary chain, oldest first. Each entry was appended by one
   * compaction and is never rewritten — only a newer summary is appended after
   * it. Retained in full so the projection's prefix stays byte-stable.
   */
  private readonly summaries: LLMMessage[] = [];

  /** Compactions since the last drain, for prefix-reset telemetry. */
  private pendingCompaction: CompactionRecord | null = null;

  /** Append a message. The only way content enters the log. */
  push(message: LLMMessage): void {
    this.entries.push(message);
  }

  /** Total messages ever recorded, including elided ones. */
  get totalLength(): number {
    return this.entries.length;
  }

  /** Messages currently projected to the model, excluding summaries. */
  get activeLength(): number {
    return this.entries.length - this.activeFrom;
  }

  /** Number of summaries written so far — i.e. compactions performed. */
  get summaryCount(): number {
    return this.summaries.length;
  }

  /**
   * The full append-only record, for checkpoint export and replay.
   *
   * Previously compaction destroyed this information; keeping it means a
   * checkpoint can replay what actually happened rather than a lossy summary.
   */
  get fullLog(): readonly LLMMessage[] {
    return this.entries;
  }

  /**
   * What goes to the model: the summary chain followed by the live tail.
   *
   * Returns fresh array cells but the SAME message objects, so a caller
   * comparing two consecutive projections sees byte-identical content for
   * everything that did not change — the §8.4 invariant.
   */
  project(): LLMMessage[] {
    return [...this.summaries, ...this.entries.slice(this.activeFrom)];
  }

  /**
   * Compact: append a new summary covering everything up to `keepRecent`
   * live messages, and mark the elided range inactive.
   *
   * Returns true when a compaction happened. The log's contents are unchanged
   * either way — only `activeFrom` and the summary chain move.
   */
  compact(args: {
    cause: CompactionCause;
    keepRecent: number;
    buildSummary: SummaryBuilder;
  }): boolean {
    const cut = this.entries.length - Math.max(0, args.keepRecent);
    // Nothing new to fold in — compacting again would append a summary that
    // says nothing and reset the prefix for no gain.
    if (cut <= this.activeFrom) return false;

    const elided = this.entries.slice(this.activeFrom, cut);
    const previousSummary =
      this.summaries.length > 0
        ? this.summaries[this.summaries.length - 1]
        : null;

    const content = args.buildSummary(previousSummary, elided);
    if (!content) return false;

    const before = this.projectionLength();
    // Rule 3: APPEND a new summary. The previous one keeps its bytes, so the
    // prompt prefix up to it survives this compaction.
    this.summaries.push({ role: "user", content });
    this.activeFrom = cut;
    const after = this.projectionLength();

    this.pendingCompaction = {
      cause: args.cause,
      elidedCount: elided.length,
      before,
      after,
    };
    return true;
  }

  private projectionLength(): number {
    return this.summaries.length + (this.entries.length - this.activeFrom);
  }

  /**
   * Drain the pending compaction record, so the turn that actually pays the
   * one-time cache cost is the one that reports it.
   */
  consumeCompaction(): CompactionRecord | null {
    const record = this.pendingCompaction;
    this.pendingCompaction = null;
    return record;
  }

  /** Reset to empty — new run, or an explicit fresh-start recovery. */
  clear(): void {
    this.entries.length = 0;
    this.summaries.length = 0;
    this.activeFrom = 0;
    this.pendingCompaction = null;
  }

  /**
   * Replace the whole log, for checkpoint restore.
   *
   * A restored log starts a new cache lineage by definition — the provider has
   * never seen this prefix — so it begins fully active with no summaries rather
   * than pretending the previous compaction state still applies.
   */
  restore(messages: readonly LLMMessage[]): void {
    this.clear();
    this.entries.push(...messages);
  }
}
