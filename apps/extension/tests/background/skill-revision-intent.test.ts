import { describe, expect, test } from "vitest";
import "../setup";
import { selectPrimarySkill } from "../../src/background/orchestrator/skills";

describe("continuation skill follows requested revision intent", () => {
  test.each([
    "Do not change the issue.",
    "Explain it without editing the draft.",
    "Never rewrite the text.",
  ])("does not turn a read-only report into revision: %s", (constraint) => {
    expect(
      selectPrimarySkill({
        query: `Read this issue and explain the reported failure. ${constraint}`,
        objective: `Read the issue and report its title and status. ${constraint}`,
        successCriteria:
          "The answer explains repeated saves of an already correct draft.",
        pageTitle: "Saved draft recovery issue",
      })?.id,
    ).not.toBe("continuation-edit");
  });

  test("does not use the page title as an instruction to edit", () => {
    expect(
      selectPrimarySkill({
        query: "Read this page and explain what happened.",
        objective: "Report the page's explanation.",
        pageTitle: "Edit previous draft: recovery report",
      })?.id,
    ).not.toBe("continuation-edit");
  });

  test("does not carry a root editing task into its current reading phase", () => {
    expect(
      selectPrimarySkill({
        query: "Revise the previous draft after reading the feedback.",
        objective: "Read the feedback and report the requested corrections.",
        successCriteria:
          "The draft corrections are explained without changing the text.",
      })?.id,
    ).not.toBe("continuation-edit");
  });

  test.each([
    "Revise the previous draft to mention Monday.",
    "Could you rewrite this paragraph more concisely?",
    "Read the feedback and edit the draft accordingly.",
    "Draft accept reply; change to decline + Monday; make casual and mention Q3 numbers",
  ])("keeps genuine revision guidance: %s", (query) => {
    expect(selectPrimarySkill({ query, objective: query })?.id).toBe(
      "continuation-edit",
    );
  });
});
