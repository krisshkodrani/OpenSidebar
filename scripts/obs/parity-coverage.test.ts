import { describe, expect, it } from "vitest";
import { summarizeParityCoverage } from "./parity-coverage";

describe("span parity coverage", () => {
  it("rejects a partial spine even when every overlapping record matches", () => {
    expect(summarizeParityCoverage(["a", "b"], ["a"])).toEqual({
      storeOnly: ["b"],
      spineOnly: [],
    });
  });

  it("detects spine records absent from the existing store", () => {
    expect(summarizeParityCoverage(["a"], ["a", "c"])).toEqual({
      storeOnly: [],
      spineOnly: ["c"],
    });
  });
});
