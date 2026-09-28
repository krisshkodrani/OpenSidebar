import { describe, expect, it } from "vitest";
import { orderTraceEntries, preferSpineSessions } from "./session-read-policy";

describe("span session read cutover", () => {
  it("uses spine rows while retaining history not yet backfilled", () => {
    expect(preferSpineSessions(
      [{ sessionId: "a", source: "spine" }],
      [{ sessionId: "a", source: "legacy" }, { sessionId: "b", source: "legacy" }],
    )).toEqual([
      { sessionId: "a", source: "spine" },
      { sessionId: "b", source: "legacy" },
    ]);
  });
});

it("orders out-of-order legacy turns by turn number", () => {
  expect(orderTraceEntries([
    { turnNumber: 2 }, { turnNumber: 3 }, { turnNumber: 1 },
  ])).toEqual([{ turnNumber: 1 }, { turnNumber: 2 }, { turnNumber: 3 }]);
});
