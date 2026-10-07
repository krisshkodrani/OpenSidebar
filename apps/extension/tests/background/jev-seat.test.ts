import { afterEach, expect, test, vi } from "vitest";
import { LLMClient } from "../../src/background/llm/client";
import { runRubricJudge } from "../../src/background/agent/completion/judge";
const rubric = {
  claim: "Saved",
  criteria: [{ id: "saved", description: "Record saved", required: true }],
  evidence: ["Record saved"],
  corpusFacts: [],
};
afterEach(() => vi.unstubAllGlobals());
test("explicit Jev judge reaches Decisions, accounts usage, and leaves executor routing unchanged", async () => {
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          model: "typesafe/jev-1.13-20260917",
          answers: {
            q0: {
              type: "choice",
              choice: "entailed",
              confidence: 0.8,
              probabilities: {
                entailed: 0.95,
                contradicted: 0.03,
                unsupported: 0.02,
              },
            },
          },
          usage: { input_tokens: 100, output_tokens: 10, cost: 0.0000042 },
        }),
        { status: 200 },
      ),
  );
  vi.stubGlobal("fetch", fetch);
  const client = new LLMClient("test-key", {
    providerMode: "openrouter",
    executorModel: "openai/gpt-6-luna",
    judgeModel: "typesafe/jev-1.13-20260917",
    useNitro: true,
  });
  const before = client.getCurrentModel();
  const result = await runRubricJudge(rubric, { seat: client });
  expect(result.pass).toBe(true);
  expect(result.usage).toEqual({
    promptTokens: 100,
    completionTokens: 10,
    totalTokens: 110,
    costUsd: 0.0000042,
  });
  expect(fetch.mock.calls[0][0]).toBe(
    "https://openrouter.ai/api/alpha/decisions",
  );
  const payload = JSON.parse(
    (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
  );
  expect(payload).toHaveProperty("questions.q0.type", "choice");
  expect(payload.model).toBe("typesafe/jev-1.13-20260917");
  expect(payload).not.toHaveProperty("messages");
  expect(client.getCurrentModel()).toBe(before);
});
test("cloud placeholder cannot escape through a direct Jev call", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const client = new LLMClient("__opensidebar_cloud__", {
    providerMode: "openrouter",
    judgeModel: "typesafe/jev-1.13",
  });
  const result = await runRubricJudge(rubric, { seat: client });
  expect(result.failureCause).toBe("seat_error");
  expect(fetch).not.toHaveBeenCalled();
});
