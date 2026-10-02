import { describe, expect, test } from "vitest";
import { clarificationQuestionForEscalation } from "../../src/background/agent/escalation-clarification-policy";

describe("escalation clarification policy", () => {
  test("asks when an assignment has multiple unresolved owners", () => {
    expect(clarificationQuestionForEscalation(
      "There is no single owner to assign: there are two eligible people and the target is unclear.",
      "Assign the case to the owner",
    )).toMatch(/Assign the case to the owner.*Which one should I use/);
  });

  test("asks when a generic selection has multiple possible targets", () => {
    expect(clarificationQuestionForEscalation(
      "Multiple plausible accounts match the request, so I cannot choose the target.",
      "Open the account and update its address",
    )).toMatch(/Which one should I use/);
  });

  test("does not turn an unavailable control or repeated failure into a user choice", () => {
    expect(clarificationQuestionForEscalation(
      "The submit button is disabled and two clicks failed.",
      "Submit the form",
    )).toBeNull();
    expect(clarificationQuestionForEscalation(
      "The requested account is clear, but the page does not expose an edit control.",
      "Update the named account",
    )).toBeNull();
  });
});
