import { describe, expect, test } from "vitest";

import { HistoryLog } from "../../src/background/agent/context-history";
import type { LLMMessage } from "../../src/background/llm/types";

const user = (content: string): LLMMessage => ({ role: "user", content });
const asst = (content: string): LLMMessage => ({ role: "assistant", content });

/** Concatenate a projection the way the wire would see it. */
const serialize = (messages: LLMMessage[]) =>
  messages.map((m) => `${m.role}:${String(m.content)}`).join("\n");

/** Longest shared prefix of two serialized projections, in characters. */
function sharedPrefixChars(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

const countingSummary = (previous: LLMMessage | null, elided: readonly LLMMessage[]) =>
  `[SUMMARY of ${elided.length}${previous ? " + prior summary" : ""}]`;

function logWith(count: number): HistoryLog {
  const log = new HistoryLog();
  for (let i = 0; i < count; i++) log.push(user(`turn ${i}`));
  return log;
}

describe("HistoryLog", () => {
  test("projects what was appended, in order", () => {
    const log = new HistoryLog();
    log.push(user("goal"));
    log.push(asst("thinking"));

    expect(log.project()).toEqual([user("goal"), asst("thinking")]);
    expect(log.totalLength).toBe(2);
  });

  // Rule 1 of the #103 contract, and RFC §8.4: a message that has been sent is
  // never mutated. This is the invariant the old in-place rewriting violated.
  test("compaction leaves every logged message byte-identical", () => {
    const log = logWith(10);
    const before = log.fullLog.map((m) => ({ ...m }));

    log.compact({ cause: "rolling_distill", keepRecent: 3, buildSummary: countingSummary });

    expect(log.fullLog).toEqual(before);
  });

  test("compaction appends a summary and elides the covered range", () => {
    const log = logWith(10);

    expect(
      log.compact({ cause: "rolling_distill", keepRecent: 3, buildSummary: countingSummary }),
    ).toBe(true);

    const projection = log.project();
    expect(projection[0].content).toBe("[SUMMARY of 7]");
    expect(projection.slice(1)).toEqual([user("turn 7"), user("turn 8"), user("turn 9")]);
    // The log itself kept everything — compaction is a projection change only.
    expect(log.totalLength).toBe(10);
  });

  // Rule 3, and the reason Bluebox's follow-up says a single mutable rolling
  // summary is insufficient: re-folding one summary changes early bytes every
  // pass, so the cache breaks every pass.
  test("a later compaction appends a NEW summary and never rewrites the old one", () => {
    const log = logWith(10);
    log.compact({ cause: "rolling_distill", keepRecent: 3, buildSummary: countingSummary });
    const firstSummary = log.project()[0];

    for (let i = 10; i < 20; i++) log.push(user(`turn ${i}`));
    log.compact({ cause: "rolling_distill", keepRecent: 3, buildSummary: countingSummary });

    const projection = log.project();
    expect(log.summaryCount).toBe(2);
    // Summary 1 is byte-identical to what was already sent...
    expect(projection[0]).toEqual(firstSummary);
    // ...and summary 2 was derived from it, per "summarise summary N + since".
    // 10 elided: entries 7..17 — the tail left live by pass 1 plus the 10 added
    // since, minus the 3 pass 2 keeps live.
    expect(projection[1].content).toBe("[SUMMARY of 10 + prior summary]");
  });

  // The payoff: everything before the compaction point keeps its bytes, so the
  // provider's cached prefix survives instead of being discarded.
  test("the prefix before a compaction point survives that compaction", () => {
    const log = logWith(10);
    log.compact({ cause: "rolling_distill", keepRecent: 3, buildSummary: countingSummary });
    const afterFirst = serialize(log.project());

    for (let i = 10; i < 20; i++) log.push(user(`turn ${i}`));
    log.compact({ cause: "rolling_distill", keepRecent: 3, buildSummary: countingSummary });
    const afterSecond = serialize(log.project());

    // The first summary is the whole surviving prefix, and it survives intact.
    const survived = sharedPrefixChars(afterFirst, afterSecond);
    expect(survived).toBeGreaterThanOrEqual("user:[SUMMARY of 7]".length);
  });

  test("a plain append changes nothing that was already projected", () => {
    const log = logWith(5);
    const before = serialize(log.project());

    log.push(user("turn 5"));

    // Pure append: the previous projection is a strict prefix of the new one.
    expect(serialize(log.project()).startsWith(before)).toBe(true);
  });

  test("refuses to compact when there is nothing new to fold in", () => {
    const log = logWith(10);
    log.compact({ cause: "rolling_distill", keepRecent: 3, buildSummary: countingSummary });

    // A second pass with no new messages would append an empty summary and
    // reset the prefix for no gain.
    expect(
      log.compact({ cause: "rolling_distill", keepRecent: 3, buildSummary: countingSummary }),
    ).toBe(false);
    expect(log.summaryCount).toBe(1);
  });

  test("refuses to compact a history shorter than the retained tail", () => {
    const log = logWith(3);

    expect(
      log.compact({ cause: "threshold_compaction", keepRecent: 5, buildSummary: countingSummary }),
    ).toBe(false);
  });

  test("a summary builder returning null aborts the compaction cleanly", () => {
    const log = logWith(10);

    expect(
      log.compact({ cause: "rolling_distill", keepRecent: 3, buildSummary: () => null }),
    ).toBe(false);
    expect(log.summaryCount).toBe(0);
    expect(log.activeLength).toBe(10);
  });

  describe("compaction record", () => {
    test("reports the reset once, to the turn that pays for it", () => {
      const log = logWith(10);
      log.compact({ cause: "rolling_distill", keepRecent: 3, buildSummary: countingSummary });

      const record = log.consumeCompaction();
      expect(record).toMatchObject({ cause: "rolling_distill", elidedCount: 7 });
      expect(record!.after).toBeLessThan(record!.before);
      // A later turn must not re-report a reset it did not cause.
      expect(log.consumeCompaction()).toBeNull();
    });

    test("is empty when no compaction ran", () => {
      expect(logWith(4).consumeCompaction()).toBeNull();
    });
  });

  describe("checkpoint", () => {
    test("the full log survives compaction for replay", () => {
      const log = logWith(10);
      log.compact({ cause: "rolling_distill", keepRecent: 3, buildSummary: countingSummary });

      // Compaction used to destroy this — a checkpoint could only replay a
      // lossy summary of what happened.
      expect(log.fullLog).toHaveLength(10);
      expect(log.fullLog[0]).toEqual(user("turn 0"));
    });

    test("restore starts a fresh cache lineage with no summaries", () => {
      const log = logWith(10);
      log.compact({ cause: "rolling_distill", keepRecent: 3, buildSummary: countingSummary });

      log.restore([user("a"), user("b")]);

      expect(log.summaryCount).toBe(0);
      expect(log.project()).toEqual([user("a"), user("b")]);
      expect(log.consumeCompaction()).toBeNull();
    });
  });
});
