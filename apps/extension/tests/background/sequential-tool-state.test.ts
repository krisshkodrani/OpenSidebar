import { describe, expect, test } from "vitest";
import { mergeGenericSequentialToolState } from "../../src/background/agent/sequential-tool-state";

describe("sequential tool state", () => {
  test("merges generic tool state into runtime state", () => {
    expect(
      mergeGenericSequentialToolState(
        {
          prevElementCount: 1,
          domModified: false,
          visuallyModified: false,
          lastDomAffectingToolName: null,
        },
        {
          prevElementCount: 3,
          domModified: true,
          visuallyModified: true,
          lastDomAffectingToolName: "click_element",
          breakLoop: false,
          completedSummary: null,
        },
      ),
    ).toEqual({
      prevElementCount: 3,
      domModified: true,
      visuallyModified: true,
      lastDomAffectingToolName: "click_element",
    });
  });

  test("does not expose control-flow fields in merged runtime state", () => {
    expect(
      mergeGenericSequentialToolState(
        {
          prevElementCount: 1,
          domModified: false,
          visuallyModified: false,
          lastDomAffectingToolName: null,
        },
        {
          prevElementCount: 2,
          domModified: false,
          visuallyModified: false,
          lastDomAffectingToolName: null,
          breakLoop: true,
          completedSummary: "Done",
        },
      ),
    ).toEqual({
      prevElementCount: 2,
      domModified: false,
      visuallyModified: false,
      lastDomAffectingToolName: null,
    });
  });
});
