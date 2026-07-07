import { describe, expect, test, vi } from "vitest";
import {
  corpusEntryToFactRef,
  deriveCriteria,
  runJudgeGate,
} from "../../src/background/agent/completion/judge-gate";
import type { JudgeSeat } from "../../src/background/agent/completion/judge";
import type { TrustedCorpusEntry } from "../../src/background/memory/trusted-corpus";

function entry(over: Partial<TrustedCorpusEntry>): TrustedCorpusEntry {
  return {
    id: "id",
    kind: "extracted_fact",
    claimKey: "k",
    scope: {},
    value: "v",
    encrypted: false,
    provenance: { source: "observation", capturedAt: 0 },
    confidence: "medium",
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

function seatReturning(text: string): JudgeSeat {
  return { runJudge: vi.fn(async () => ({ text, model: "m", providerId: "p" })) };
}

describe("deriveCriteria", () => {
  test("splits on newlines / semicolons / periods, all required", () => {
    const c = deriveCriteria("Email is filled; no error shown.\nForm submitted");
    expect(c.map((x) => x.description)).toEqual([
      "Email is filled",
      "no error shown",
      "Form submitted",
    ]);
    expect(c.every((x) => x.required)).toBe(true);
  });

  test("falls back to the whole string when unsplittable", () => {
    expect(deriveCriteria("just one criterion")).toHaveLength(1);
  });
});

describe("corpusEntryToFactRef", () => {
  test("profile fact → label + value text", () => {
    const ref = corpusEntryToFactRef(
      entry({
        kind: "personal_profile_fact",
        claimKey: "fact:email:1",
        value: { id: "fact:email:1", label: "Email", value: "sam@x.com", kind: "fact", confidence: "high" },
      }),
    );
    expect(ref).toEqual({ claimKey: "fact:email:1", text: "Email sam@x.com", encrypted: false });
  });

  test("encrypted fact → empty text (opaque)", () => {
    const ref = corpusEntryToFactRef(entry({ encrypted: true, value: "enc:v1:..." }));
    expect(ref.text).toBe("");
    expect(ref.encrypted).toBe(true);
  });

  test("extracted fact → the summary string", () => {
    expect(corpusEntryToFactRef(entry({ value: "the total is 42" })).text).toBe("the total is 42");
  });
});

describe("runJudgeGate", () => {
  const evidence = ["submitted email sam@x.com"];

  test("skips the judge when the corpus entails every criterion", async () => {
    const seat = seatReturning("{}");
    const outcome = await runJudgeGate(
      {
        claim: "email matches",
        successCriteria: "submitted email equals primary email address",
        evidence,
        corpusFacts: [
          { claimKey: "k", text: "submitted email equals primary email address", encrypted: false },
        ],
      },
      { seat },
    );
    expect(outcome).toMatchObject({ decision: "accept", judged: false });
    expect(seat.runJudge).not.toHaveBeenCalled();
  });

  test("judge confirms → accept", async () => {
    const seat = seatReturning('{"pass": true, "confidence": 0.9, "perCriterion": [{"id":"c1","pass":true}]}');
    const outcome = await runJudgeGate(
      { claim: "x", successCriteria: "obscure unmatched criterion phrase", evidence, corpusFacts: [] },
      { seat },
    );
    expect(outcome.decision).toBe("accept");
    expect(outcome.judged).toBe(true);
  });

  test("judge does not confirm → reroute", async () => {
    const seat = seatReturning('{"pass": false, "confidence": 0.8, "perCriterion": [{"id":"c1","pass":false}]}');
    const outcome = await runJudgeGate(
      { claim: "x", successCriteria: "obscure unmatched criterion phrase", evidence, corpusFacts: [] },
      { seat },
    );
    expect(outcome.decision).toBe("reroute");
  });

  test("judge finds a contradiction → reroute", async () => {
    const seat = seatReturning(
      '{"pass": true, "confidence": 1, "perCriterion": [{"id":"c1","pass":true}], "entailment": [{"claimKey":"fact:email","label":"contradicted"}]}',
    );
    const outcome = await runJudgeGate(
      { claim: "x", successCriteria: "obscure unmatched criterion phrase", evidence, corpusFacts: [] },
      { seat },
    );
    expect(outcome.decision).toBe("reroute");
    expect(outcome.reason).toMatch(/contradict/i);
  });

  test("judge unavailable (fail-open) → reroute, defers to human-gated action", async () => {
    const seat: JudgeSeat = { runJudge: vi.fn(async () => { throw new Error("down"); }) };
    const outcome = await runJudgeGate(
      { claim: "x", successCriteria: "obscure unmatched criterion phrase", evidence, corpusFacts: [] },
      { seat },
    );
    expect(outcome.decision).toBe("reroute");
    expect(outcome.verdict?.source).toBe("fail_open");
  });
});
