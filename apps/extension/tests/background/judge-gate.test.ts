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

  test("keeps punctuation inside a quoted objective in its outcome criterion", () => {
    const criterion = 'The subtask outcome for "Save the purchase request as a draft; preserve the other editor\'s changes." is verified on the page or in tool output';
    expect(deriveCriteria(`${criterion}.`)).toEqual([
      { id: "c1", description: criterion, required: true },
    ]);
  });

  test("preserves decimals, email addresses, and URLs while separating sentences", () => {
    expect(deriveCriteria("Total is €24.50. Contact is sam@example.com; URL is https://example.com/record. Status is Draft.").map((c) => c.description)).toEqual([
      "Total is €24.50",
      "Contact is sam@example.com",
      "URL is https://example.com/record",
      "Status is Draft",
    ]);
  });

  test("keeps parenthetical examples and nested clauses attached to their outcome", () => {
    const criterion = "The selection view is visible (e.g. a table (with sort controls); current rows shown)";
    expect(deriveCriteria(`${criterion}. The record is saved.`)).toEqual([
      { id: "c1", description: criterion, required: true },
      { id: "c2", description: "The record is saved", required: true },
    ]);
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

  test("judges current evidence even when a corpus fact exactly matches", async () => {
    const seat = seatReturning('{"pass":true,"confidence":1,"perCriterion":[{"id":"c1","pass":true}]}');
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
    expect(outcome).toMatchObject({ decision: "accept", judged: true });
    expect(seat.runJudge).toHaveBeenCalledWith(expect.objectContaining({
      rubric: expect.objectContaining({ evidence, corpusFacts: ["k = submitted email equals primary email address"] }),
    }));
  });

  test.each([
    ["Customer billing country is France", "Customer billing country is Germany", "Current billing country: Germany"],
    ["Request amount is 25 EUR", "Request amount is 35 EUR", "Current request amount: 35 EUR"],
    ["Requested status is Draft", "Requested status is Draft", "Current record status: Submitted"],
  ])("does not bypass the judge for corpus overlap: %s", async (criterion, fact, observation) => {
    const seat = seatReturning('{"pass":false,"confidence":1,"perCriterion":[{"id":"c1","pass":false}]}');
    const outcome = await runJudgeGate({
      claim: criterion, successCriteria: criterion, evidence: [observation],
      corpusFacts: [{ claimKey: "stored-fact", text: fact, encrypted: false }],
    }, { seat });
    expect(seat.runJudge).toHaveBeenCalledOnce();
    expect(outcome).toMatchObject({ decision: "reroute", judged: true });
  });

  test("malformed criterion ids cannot use the unavailable-judge acceptance path", async () => {
    const outcome = await runJudgeGate(
      { claim: "Saved", successCriteria: "Correct persisted value", evidence: ["Saved successfully"], corpusFacts: [] },
      { seat: seatReturning('{"pass":true,"perCriterion":[{"id":"renamed","pass":true}]}') },
    );
    expect(outcome.decision).toBe("reroute");
    expect(outcome.verdict?.failureCause).toBe("contract_error");
  });

  test.each([
    ["order note", "Saved note matches the tracking number observed on the source order"],
    ["request update", "Unrelated cost center changes by another editor are preserved"],
  ])("does not accept %s when a requirement after the eighth fails", async (_workflow, constraint) => {
    const satisfied = [
      "Correct record is open", "Requested owner is selected",
      "Requested date is saved", "Requested amount is saved",
      "Requested currency is saved", "Requested status is saved",
      "Save confirmation is observed", "Saved values are read back",
    ];
    const seat: JudgeSeat = {
      runJudge: vi.fn(async ({ rubric }) => {
        const perCriterion = rubric!.criteria.map((criterion) => ({
          id: criterion.id,
          pass: criterion.description !== constraint,
        }));
        return {
          text: "",
          model: "typesafe/jev-1.13-20260917", providerId: "openrouter",
          decision: {
            model: "typesafe/jev-1.13-20260917",
            answers: Object.fromEntries(perCriterion.map((criterion, index) => [
              `q${index}`,
              { type: "choice", choice: criterion.pass ? "entailed" : "contradicted",
                confidence: 1, probabilities: { entailed: criterion.pass ? 1 : 0,
                  contradicted: criterion.pass ? 0 : 1, unsupported: 0 } },
            ])),
          },
        };
      }),
    };
    const outcome = await runJudgeGate({
      claim: "Complete the requested update while preserving all constraints",
      successCriteria: [...satisfied, constraint].join("; "),
      evidence: ["Saved values confirmed, but the final constraint was violated"],
      corpusFacts: [],
    }, { seat });
    expect(outcome.decision).toBe("reroute");
    expect(outcome.reason).toContain(constraint);
    expect(outcome.verdict?.perCriterion).toContainEqual({ id: "c9", pass: false });
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
    expect(outcome.reason).toContain("obscure unmatched criterion phrase");
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

  test("judge unavailable (fail-open) → accept stands; infrastructure failure must not punish the task", async () => {
    const seat: JudgeSeat = { runJudge: vi.fn(async () => { throw new Error("down"); }) };
    const outcome = await runJudgeGate(
      { claim: "x", successCriteria: "obscure unmatched criterion phrase", evidence, corpusFacts: [] },
      { seat },
    );
    expect(outcome.decision).toBe("accept");
    expect(outcome.judged).toBe(true);
    expect(outcome.verdict?.source).toBe("fail_open");
    expect(outcome.verdict?.failureCause).toBe("seat_error");
    expect(outcome.reason).toMatch(/unavailable/i);
  });
});
