import { describe, expect, test, vi } from "vitest";
import {
  createJudgeVerdictCache,
  judgeCacheKey,
  runRubricJudge,
  type JudgeRubric,
  type JudgeSeat,
} from "../../src/background/agent/completion/judge";

const rubric: JudgeRubric = {
  claim: "The submitted email equals the user's primary email",
  criteria: [
    { id: "c1", description: "submitted email == user primary email", required: true },
    { id: "c2", description: "no validation error shown", required: false },
  ],
  evidence: ["field_value submitted email = sam@example.com", "no validation error"],
  corpusFacts: ["fact:primary-email = sam@example.com"],
};

function seatReturning(text: string): JudgeSeat {
  return {
    runJudge: vi.fn(async () => ({ text, model: "glm-5p2", providerId: "fireworks" })),
  };
}

function seatReturningWithUsage(
  text: string,
  usage: { promptTokens: number; completionTokens: number; totalTokens: number; costUsd?: number },
): JudgeSeat {
  return {
    runJudge: vi.fn(async () => ({ text, model: "gpt-oss-120b", providerId: "fireworks", usage })),
  };
}

describe("judgeCacheKey", () => {
  test("is deterministic and varies with evidence", () => {
    expect(judgeCacheKey(rubric)).toBe(judgeCacheKey(rubric));
    const changed = { ...rubric, evidence: ["different evidence"] };
    expect(judgeCacheKey(changed)).not.toBe(judgeCacheKey(rubric));
  });
});

describe("runRubricJudge", () => {
  test("allows preserved evidence for prerequisite views replaced by terminal state", async () => {
    const seat = seatReturning(
      '{"pass": true, "confidence": 0.9, "perCriterion": [{"id":"c1","pass":true},{"id":"c2","pass":true}]}',
    );
    await runRubricJudge(rubric, { seat });

    const call = vi.mocked(seat.runJudge).mock.calls[0]?.[0];
    const criteriaJson = call!.userPrompt.split("CRITERIA:\n")[1]!.split("\n\nEVIDENCE:")[0]!;
    expect(JSON.parse(criteriaJson)).toEqual(rubric.criteria);
    expect(call?.systemPrompt).toContain(
      "preserved trajectory evidence may establish that criterion",
    );
    expect(call?.systemPrompt).toContain(
      "not require the old control or table to coexist with terminal confirmation",
    );
  });

  test.each([
    [{ id: "renamed-c1", pass: true }, { id: "c2", pass: true }],
    [{ id: "c1", pass: false }, { id: "c1", pass: true }],
    [{ id: "c1", pass: "true" }, { id: "c2", pass: true }],
  ])("rejects invalid criterion identities or decisions without caching", async (...criteria) => {
    const seat = seatReturningWithUsage(JSON.stringify({ pass: true, confidence: 1, perCriterion: criteria }), { promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    const cache = createJudgeVerdictCache();
    const verdict = await runRubricJudge(rubric, { seat, cache });
    expect(verdict).toMatchObject({ pass: false, source: "fail_open", failureCause: "contract_error" });
    expect(verdict.usage?.totalTokens).toBe(15);
    await runRubricJudge(rubric, { seat, cache });
    expect(seat.runJudge).toHaveBeenCalledTimes(2);
  });

  test("criterion descriptions participate in the verdict cache", async () => {
    const changed = { ...rubric, criteria: rubric.criteria.map(c => ({ ...c, description: "A different required outcome" })) };
    expect(judgeCacheKey(changed)).not.toBe(judgeCacheKey(rubric));
  });

  test("parses a passing verdict", async () => {
    const seat = seatReturning(
      'Here you go: {"pass": true, "confidence": 0.9, "perCriterion": [{"id":"c1","pass":true},{"id":"c2","pass":true}], "entailment": [{"claimKey":"fact:primary-email","label":"entailed"}]}',
    );
    const v = await runRubricJudge(rubric, { seat });
    expect(v.source).toBe("judge");
    expect(v.pass).toBe(true);
    expect(v.confidence).toBe(0.9);
    expect(v.entailment).toEqual([{ claimKey: "fact:primary-email", label: "entailed" }]);
  });

  test("a failed required criterion fails the verdict even if the model says pass", async () => {
    const seat = seatReturning(
      '{"pass": true, "confidence": 1, "perCriterion": [{"id":"c1","pass":false},{"id":"c2","pass":true}], "entailment": []}',
    );
    const v = await runRubricJudge(rubric, { seat });
    expect(v.pass).toBe(false); // required c1 failed → overrides top-level pass
  });

  test("a missing required criterion fails the verdict", async () => {
    const seat = seatReturning('{"pass": true, "confidence": 1, "perCriterion": [{"id":"c2","pass":true}]}');
    const v = await runRubricJudge(rubric, { seat });
    expect(v.pass).toBe(false);
  });

  test("drops invalid entailment labels and clamps confidence", async () => {
    const seat = seatReturning(
      '{"pass": false, "confidence": 5, "perCriterion": [], "entailment": [{"claimKey":"k","label":"bogus"},{"claimKey":"k2","label":"contradicted"}]}',
    );
    const v = await runRubricJudge(rubric, { seat });
    expect(v.confidence).toBe(1);
    expect(v.entailment).toEqual([{ claimKey: "k2", label: "contradicted" }]);
  });

  test("fails open to human on a seat error, naming the cause", async () => {
    const seat: JudgeSeat = { runJudge: vi.fn(async () => { throw new Error("boom"); }) };
    const v = await runRubricJudge(rubric, { seat });
    expect(v).toMatchObject({ source: "fail_open", pass: false, confidence: 0 });
    expect(v.failureCause).toBe("seat_error");
    expect(v.failureDetail).toBe("boom");
    expect(typeof v.durationMs).toBe("number");
  });

  test("fails open to human on unparseable output, naming the cause", async () => {
    const v = await runRubricJudge(rubric, { seat: seatReturning("no json here") });
    expect(v.source).toBe("fail_open");
    expect(v.failureCause).toBe("parse_error");
    expect(v.failureDetail).toBe("no json here");
    expect(v.model).toBe("glm-5p2");
  });

  test("fails open to human on timeout, naming the cause", async () => {
    const seat: JudgeSeat = { runJudge: vi.fn(() => new Promise(() => {})) };
    const v = await runRubricJudge(rubric, { seat, timeoutMs: 10 });
    expect(v.source).toBe("fail_open");
    expect(v.failureCause).toBe("timeout");
  });

  test("a real verdict carries model and duration but no failure cause", async () => {
    const seat = seatReturning('{"pass": false, "confidence": 0.5, "perCriterion": [], "entailment": []}');
    const v = await runRubricJudge(rubric, { seat });
    expect(v.source).toBe("judge");
    expect(v.model).toBe("glm-5p2");
    expect(typeof v.durationMs).toBe("number");
    expect(v.failureCause).toBeUndefined();
  });

  test("threads provider + token usage from the seat onto a real verdict", async () => {
    const seat = seatReturningWithUsage(
      '{"pass": true, "confidence": 0.8, "perCriterion": [{"id":"c1","pass":true},{"id":"c2","pass":true}], "entailment": []}',
      { promptTokens: 420, completionTokens: 80, totalTokens: 500, costUsd: 0.0004 },
    );
    const v = await runRubricJudge(rubric, { seat });
    expect(v.providerId).toBe("fireworks");
    expect(v.usage).toEqual({ promptTokens: 420, completionTokens: 80, totalTokens: 500, costUsd: 0.0004 });
  });

  test("still attaches usage on a parse-error fail-open (the call was still billed)", async () => {
    const seat = seatReturningWithUsage("not json", {
      promptTokens: 400,
      completionTokens: 5,
      totalTokens: 405,
    });
    const v = await runRubricJudge(rubric, { seat });
    expect(v.source).toBe("fail_open");
    expect(v.failureCause).toBe("parse_error");
    expect(v.usage?.totalTokens).toBe(405);
    expect(v.providerId).toBe("fireworks");
  });

  test("caches a real verdict but not a fail-open", async () => {
    const cache = createJudgeVerdictCache();
    const good = seatReturning('{"pass": false, "confidence": 0.5, "perCriterion": [], "entailment": []}');
    await runRubricJudge(rubric, { seat: good, cache });
    await runRubricJudge(rubric, { seat: good, cache });
    expect(good.runJudge).toHaveBeenCalledTimes(1); // second call served from cache

    const bad = { runJudge: vi.fn(async () => { throw new Error("x"); }) };
    const other = { ...rubric, claim: "different claim entirely" };
    await runRubricJudge(other, { seat: bad, cache });
    await runRubricJudge(other, { seat: bad, cache });
    expect(bad.runJudge).toHaveBeenCalledTimes(2); // fail-open not cached → retried
  });
});

describe("typed Jev runtime decisions", () => {
  const typedRubric = { claim: "Saved record", criteria: [{ id: "record", description: "Requested record saved", required: true }], evidence: ["Record 42 saved"], corpusFacts: [] };
  const answer = (probability: number) => ({ model: "typesafe/jev-1.13-20260917", answers: { q0: { type: "choice", choice: "entailed", confidence: 1, probabilities: { entailed: probability, contradicted: 0, unsupported: 1 - probability } } } });
  const seat = (decision: unknown): JudgeSeat => ({ runJudge: async args => {
    expect(args.rubric).toEqual(typedRubric);
    return { text: "", model: "typesafe/jev-1.13-20260917", providerId: "openrouter", decision, usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25, costUsd: 0.000001 } };
  } });
  test("uses entailment probability, preserves criterion identity and cost without invented rationale", async () => {
    const result = await runRubricJudge(typedRubric, { seat: seat(answer(0.95)) });
    expect(result.pass).toBe(true);
    expect(result.confidenceKind).toBe("classifier");
    expect(result.confidence).toBe(0.95);
    expect(result.perCriterion).toEqual([{ id: "record", pass: true }]);
    expect(result.usage?.costUsd).toBe(0.000001);
    expect((await runRubricJudge(typedRubric, { seat: seat(answer(0.6)) })).pass).toBe(false);
  });
  test("malformed or mismatched decision remains a contract failure with its cost", async () => {
    const result = await runRubricJudge(typedRubric, { seat: seat({ ...answer(0.95), answers: {} }) });
    expect(result.failureCause).toBe("contract_error");
    expect(result.pass).toBe(false);
    expect(result.usage?.costUsd).toBe(0.000001);
  });
  test("timeout aborts the actual seat request", async () => {
    let signal: AbortSignal | undefined;
    const result = await runRubricJudge(typedRubric, { timeoutMs: 5, seat: { runJudge: args => {
      signal = args.signal;
      return new Promise(() => {});
    } } });
    expect(result.failureCause).toBe("timeout");
    expect(signal?.aborted).toBe(true);
  });
});
