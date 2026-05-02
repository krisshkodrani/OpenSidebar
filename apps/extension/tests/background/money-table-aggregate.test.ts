import { describe, expect, test } from "vitest";
import "../setup";

import {
  formatSeenRowRanges,
  formatSeenRows,
  getMoneyTableNextActionHint,
  parseMoneyAmount,
  parseSeenRowRanges,
  type MoneyTableAggregate,
} from "../../src/background/agent/money-table-aggregate";

function aggregate(
  overrides: Partial<MoneyTableAggregate> = {},
): MoneyTableAggregate {
  return {
    mode: "max",
    label: "salary",
    bestName: null,
    bestAmount: null,
    bestDisplay: null,
    seenRows: new Set<number>(),
    totalRows: null,
    currentStart: null,
    currentEnd: null,
    ...overrides,
  };
}

describe("money-table aggregate helpers", () => {
  test("parses formatted money amounts", () => {
    expect(parseMoneyAmount("$123,456.78")).toBe(123456);
    expect(parseMoneyAmount("salary: $ 9,001")).toBe(9001);
    expect(parseMoneyAmount("not money")).toBeNull();
  });

  test("formats seen rows and compact row ranges", () => {
    const rows = new Set([5, 1, 2, 4, 8]);

    expect(formatSeenRows(aggregate({ seenRows: rows, totalRows: 10 }))).toBe(
      "5/10",
    );
    expect(formatSeenRows(aggregate({ seenRows: rows }))).toBe("5");
    expect(formatSeenRowRanges(rows)).toBe("1-2,4-5,8");
    expect(formatSeenRowRanges(new Set())).toBe("none");
  });

  test("parses compact row ranges", () => {
    expect(Array.from(parseSeenRowRanges("1-3, 5, bad, 7-8"))).toEqual([
      1,
      2,
      3,
      5,
      7,
      8,
    ]);
    expect(Array.from(parseSeenRowRanges(""))).toEqual([]);
    expect(Array.from(parseSeenRowRanges("1-2-3, -1, 5-3"))).toEqual([]);
  });

  test("recommends next table action from coverage state", () => {
    expect(getMoneyTableNextActionHint(aggregate())).toContain(
      "continue through the visible pagination controls",
    );
    expect(
      getMoneyTableNextActionHint(
        aggregate({
          seenRows: new Set([1, 2, 3]),
          totalRows: 3,
          currentStart: 1,
          currentEnd: 3,
        }),
      ),
    ).toContain("call done");
    expect(
      getMoneyTableNextActionHint(
        aggregate({
          seenRows: new Set([1, 2, 3]),
          totalRows: 6,
          currentStart: 1,
          currentEnd: 3,
        }),
      ),
    ).toContain("click Next");
    expect(
      getMoneyTableNextActionHint(
        aggregate({
          seenRows: new Set([4, 5, 6]),
          totalRows: 6,
          currentStart: 4,
          currentEnd: 6,
        }),
      ),
    ).toContain("go backward");
  });
});
