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

describe("judgeCacheKey", () => {
  test("is deterministic and varies with evidence", () => {
    expect(judgeCacheKey(rubric)).toBe(judgeCacheKey(rubric));
    const changed = { ...rubric, evidence: ["different evidence"] };
    expect(judgeCacheKey(changed)).not.toBe(judgeCacheKey(rubric));
  });
});

describe("runRubricJudge", () => {
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

  test("fails open to human on a seat error", async () => {
    const seat: JudgeSeat = { runJudge: vi.fn(async () => { throw new Error("boom"); }) };
    const v = await runRubricJudge(rubric, { seat });
    expect(v).toMatchObject({ source: "fail_open", pass: false, confidence: 0 });
  });

  test("fails open to human on unparseable output", async () => {
    const v = await runRubricJudge(rubric, { seat: seatReturning("no json here") });
    expect(v.source).toBe("fail_open");
  });

  test("fails open to human on timeout", async () => {
    const seat: JudgeSeat = { runJudge: vi.fn(() => new Promise(() => {})) };
    const v = await runRubricJudge(rubric, { seat, timeoutMs: 10 });
    expect(v.source).toBe("fail_open");
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
