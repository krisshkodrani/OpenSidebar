import { describe, it, expect } from "vitest";
import {
  aggregateResults,
  formatBenchReport,
} from "../../../../scripts/bench/aggregate";
import type {
  BenchDifficulty,
  BenchJudgeOutcome,
  BenchTaskResult,
} from "../../../../scripts/bench/types";

function result(
  id: string,
  level: BenchDifficulty,
  status: BenchTaskResult["evidence"]["completionStatus"],
  outcome: BenchJudgeOutcome | null,
  opts: { turns?: number; cost?: number | null } = {},
): BenchTaskResult {
  return {
    evidence: {
      task: { task_id: id, confirmed_task: "x", website: "https://a.com", level },
      completionStatus: status,
      doneSummary: "",
      trajectory: [],
      finalUrl: "https://a.com",
      turns: opts.turns ?? 3,
      costUsd: opts.cost ?? null,
      durationMs: 1000,
      traceFiles: [],
    },
    verdict:
      outcome == null
        ? null
        : { task_id: id, outcome, confidence: null, reasoning: "", judgeModel: "j" },
  };
}

describe("bench aggregate — aggregateResults", () => {
  it("computes pass rate over scored (non-skipped) tasks", () => {
    const agg = aggregateResults([
      result("a", "easy", "completed", "success", { cost: 0.1 }),
      result("b", "easy", "failed", "failure", { cost: 0.2 }),
      result("c", "medium", "completed", "success", { cost: 0.3 }),
      result("d", "hard", "skipped", null),
    ]);
    expect(agg.total).toBe(4);
    expect(agg.skipped).toBe(1);
    expect(agg.scored).toBe(3);
    expect(agg.successes).toBe(2);
    expect(agg.passRate).toBeCloseTo(2 / 3);
    expect(agg.totalCostUsd).toBeCloseTo(0.6);
  });

  it("counts uncertain as a non-success but keeps it in the denominator", () => {
    const agg = aggregateResults([
      result("a", "easy", "completed", "success"),
      result("b", "easy", "completed", "uncertain"),
    ]);
    expect(agg.scored).toBe(2);
    expect(agg.successes).toBe(1);
    expect(agg.uncertain).toBe(1);
    expect(agg.passRate).toBeCloseTo(0.5);
  });

  it("excludes skipped tasks from per-level totals", () => {
    const agg = aggregateResults([
      result("a", "hard", "skipped", null),
      result("b", "hard", "completed", "failure"),
    ]);
    expect(agg.byLevel.hard.total).toBe(1);
    expect(agg.byLevel.hard.successes).toBe(0);
  });

  it("reports null cost when no run reported cost", () => {
    const agg = aggregateResults([result("a", "easy", "completed", "success")]);
    expect(agg.totalCostUsd).toBeNull();
  });

  it("computes median turns over scored tasks", () => {
    const agg = aggregateResults([
      result("a", "easy", "completed", "success", { turns: 2 }),
      result("b", "easy", "completed", "failure", { turns: 4 }),
      result("c", "easy", "completed", "failure", { turns: 9 }),
    ]);
    expect(agg.medianTurns).toBe(4);
  });

  it("handles an all-skipped sweep without dividing by zero", () => {
    const agg = aggregateResults([result("a", "easy", "skipped", null)]);
    expect(agg.scored).toBe(0);
    expect(agg.passRate).toBe(0);
  });
});

describe("bench aggregate — formatBenchReport", () => {
  const agg = aggregateResults([
    result("a", "easy", "completed", "success"),
    result("b", "medium", "failed", "failure"),
  ]);

  it("renders the headline score and the honest disagreement placeholder", () => {
    const report = formatBenchReport(agg, {
      source: "osunlp/Online-Mind2Web",
      revision: "abc",
      modelConfigLabel: "fireworks / kimi",
      judgeModel: "openai/gpt-5.4-mini",
      date: "2026-06-10",
    });
    expect(report).toMatch(/## Score: 50\.0%/);
    expect(report).toMatch(/disagreement.*not yet measured/i);
    expect(report).toMatch(/Sample size is 2 scored tasks/);
  });

  it("includes a measured disagreement rate when provided", () => {
    const report = formatBenchReport(agg, {
      source: "osunlp/Online-Mind2Web",
      revision: "abc",
      modelConfigLabel: "fireworks / kimi",
      judgeModel: "openai/gpt-5.4-mini",
      date: "2026-06-10",
      manualDisagreementRate: 0.1,
    });
    expect(report).toMatch(/disagreement \(20% sample\): 10\.0%/);
  });
});
