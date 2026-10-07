import { describe, expect, it } from "vitest";
import {
  jevRubricRequest,
  parseJevRubricResponse,
} from "../../src/background/llm/jev-decision";
const rubric = {
  claim: "Saved",
  criteria: [
    { id: "saved", description: "Saved record exists", required: true },
  ],
  evidence: ["Saved record ID 12"],
  corpusFacts: [],
};
const response = {
  model: "typesafe/jev-1.13-20260917",
  provider: "TypeSafe",
  answers: {
    q0: {
      type: "choice",
      choice: "entailed",
      confidence: 0.7,
      probabilities: { entailed: 0.9, contradicted: 0.05, unsupported: 0.05 },
    },
  },
};
describe("Jev typed rubric adapter", () => {
  it("uses typed decisions and keeps evidence as data", () => {
    expect(jevRubricRequest(rubric).questions.q0.type).toBe("choice");
    expect(jevRubricRequest(rubric).state.evidence).toEqual(rubric.evidence);
    const result = parseJevRubricResponse(rubric, response);
    expect(result.criteria[0].confidence).toBe(0.7);
    expect(result.criteria[0].probabilities.entailed).toBe(0.9);
    expect(result.criteria[0]).not.toHaveProperty("rationale");
    expect(result.confidenceKind).toBe("classifier");
  });
  it("rejects missing, malformed, or misrouted decisions", () => {
    expect(() =>
      parseJevRubricResponse(rubric, { ...response, answers: {} }),
    ).toThrow();
    expect(() =>
      parseJevRubricResponse(rubric, { ...response, model: "another-model" }),
    ).toThrow();
    expect(() =>
      parseJevRubricResponse(rubric, {
        ...response,
        answers: { q0: { ...response.answers.q0, confidence: 2 } },
      }),
    ).toThrow();
    expect(() => jevRubricRequest({ ...rubric, criteria: [] })).toThrow();
  });
});
