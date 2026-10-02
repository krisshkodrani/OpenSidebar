import { describe, expect, test, vi } from "vitest";
import { jevQuestions, parseJevVerdict, requestJevVerdict } from "../../src/background/agent/completion/jev-judge";
import type { JudgeRubric } from "../../src/background/agent/completion/judge";
import { LLM_REQUEST_OBSERVATION, type LlmRequestObservation } from "../../src/background/llm/transport-observation";

const rubric: JudgeRubric = {
  claim: "The submitted form has the requested value",
  criteria: [{ id: "submitted", description: "The saved value matches the request", required: true }],
  evidence: ["Saved value: example"],
  corpusFacts: ["requested value = example"],
};

describe("Jev rubric decisions", () => {
  test("maps typed answers and reported cost to a verdict", () => {
    expect(Object.keys(jevQuestions(rubric))).toEqual(["criterion_0", "fact_0"]);
    const verdict = parseJevVerdict(rubric, {
      answers: {
        criterion_0: { type: "noul", noul: 0.9 },
        fact_0: { type: "choice", choice: "entailed" },
      },
      usage: { input_tokens: 100, output_tokens: 8, cost: 0.0000042 },
    });
    expect(verdict.pass).toBe(true);
    expect(verdict.entailment).toEqual([{ claimKey: rubric.corpusFacts[0], label: "entailed" }]);
    expect(verdict.usage?.costUsd).toBe(0.0000042);
  });

  test("rejects missing answers rather than turning them into a pass", () => {
    expect(() => parseJevVerdict(rubric, { answers: {} })).toThrow(/criterion_0/);
  });

  test("sends one Decisions API request with independent questions", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      model: "typesafe/jev-1.13-20260917",
      answers: {
        criterion_0: { type: "noul", noul: 0.8 },
        fact_0: { type: "choice", choice: "entailed" },
      },
      usage: { input_tokens: 20, output_tokens: 2, cost: 0.000001 },
    }), { status: 200 }));
    try {
      const verdict = await requestJevVerdict(rubric, "test-key", "typesafe/jev-1.13");
      expect(verdict.usage?.costUsd).toBe(0.000001);
      expect(fetchMock.mock.calls[0]?.[0]).toBe("https://openrouter.ai/api/alpha/decisions");
      const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
      expect(Object.keys(body.questions)).toEqual(["criterion_0", "fact_0"]);
      const observation = (fetchMock.mock.calls[0]?.[1] as RequestInit & {
        [LLM_REQUEST_OBSERVATION]: LlmRequestObservation;
      })[LLM_REQUEST_OBSERVATION];
      expect(observation.role).toBe("judge");
    } finally {
      fetchMock.mockRestore();
    }
  });
});
