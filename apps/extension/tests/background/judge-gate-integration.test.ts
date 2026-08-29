import { afterEach, describe, expect, test, vi } from "vitest";
import "../setup";
import { runHighRiskJudgeGate } from "../../src/background/orchestrator/high-risk-judge-gate";
import {
  TRUSTED_CORPUS_STORAGE_KEY,
  type TrustedCorpusEntry,
} from "../../src/background/memory/trusted-corpus";
import { runJudgeGate } from "../../src/background/agent/completion/judge-gate";
import type { JudgeSeat } from "../../src/background/agent/completion/judge";

/**
 * The RFC's "claims fixture" scenario as a deterministic integration test:
 * evidence that contradicts a seeded corpus fact must downgrade a high-risk
 * accept to reroute. Drives the real orchestrator judge-gate path
 * (runHighRiskJudgeGate → corpus load → entailment gate → judge gate) with a
 * fake judge seat, so it needs no API key. A headed hard-tier e2e that asserts
 * the same reroute against a live model remains a user-runnable follow-up.
 */

const seededFact: TrustedCorpusEntry = {
  id: "e1",
  kind: "extracted_fact",
  claimKey: "task-1:node-1",
  scope: {},
  value: "the shipping country is Germany",
  encrypted: false,
  provenance: { source: "observation", capturedAt: 1 },
  confidence: "medium",
  version: 1,
  createdAt: 1,
  updatedAt: 1,
};

function seedCorpus(entries: TrustedCorpusEntry[]): void {
  vi.spyOn(chrome.storage.local, "get").mockImplementation((async (key: string) =>
    key === TRUSTED_CORPUS_STORAGE_KEY
      ? { [TRUSTED_CORPUS_STORAGE_KEY]: { __version: 1, value: entries } }
      : {}) as typeof chrome.storage.local.get);
}

function verifierWithJudgeSeat(seat: JudgeSeat) {
  return {
    verifyNode: async () => ({ decision: "accept" as const, reason: "", confidence: 1 }),
    judgeGate: (input: Parameters<typeof runJudgeGate>[0]) =>
      runJudgeGate(input, { seat }),
  };
}

const task = { id: "task-1", query: "purchase and ship the item internationally" };
const node = {
  id: "node-1",
  description: "Complete the international shipping order",
  successCriteria: "the shipping country is France",
};
const evidence = [{ claim: "shipping country set to Germany" }];

afterEach(() => vi.restoreAllMocks());

describe("high-risk judge gate against a seeded corpus fact", () => {
  test("evidence contradicting the corpus fact downgrades accept → reroute", async () => {
    seedCorpus([seededFact]);
    const seat: JudgeSeat = {
      runJudge: vi.fn(async () => ({
        text:
          '{"pass": false, "confidence": 0.9, "perCriterion": [{"id":"c1","pass":false}], "entailment": [{"claimKey":"task-1:node-1","label":"contradicted"}]}',
        model: "glm-5p2",
        providerId: "fireworks",
      })),
    };
    const outcome = await runHighRiskJudgeGate(
      task,
      node,
      verifierWithJudgeSeat(seat),
      evidence,
      "shipped to Germany",
    );
    // The lexical gate could not resolve France-vs-Germany, so the judge ran…
    expect(seat.runJudge).toHaveBeenCalledTimes(1);
    // …and it found the contradiction, so completion is not accepted.
    expect(outcome?.decision).toBe("reroute");
    expect(outcome?.judged).toBe(true);
  });

  test("a confirming judge keeps the accept", async () => {
    seedCorpus([seededFact]);
    const seat: JudgeSeat = {
      runJudge: vi.fn(async () => ({
        text: '{"pass": true, "confidence": 0.9, "perCriterion": [{"id":"c1","pass":true}]}',
        model: "glm-5p2",
        providerId: "fireworks",
      })),
    };
    const outcome = await runHighRiskJudgeGate(
      task,
      node,
      verifierWithJudgeSeat(seat),
      evidence,
      "shipped to France",
    );
    expect(outcome?.decision).toBe("accept");
  });

  test("judges structured events together with the verifier-accepted summary", async () => {
    seedCorpus([]);
    const seat: JudgeSeat = {
      runJudge: vi.fn(async () => ({
        text: '{"pass": true, "confidence": 0.9, "perCriterion": [{"id":"c1","pass":true}]}',
        model: "glm-5p2",
        providerId: "fireworks",
      })),
    };

    await runHighRiskJudgeGate(
      task,
      node,
      verifierWithJudgeSeat(seat),
      [{ claim: "terminal confirmation visible" }],
      "Earlier workflow view preserved overdue IDs REC-1042 and REC-1077.",
    );

    const call = vi.mocked(seat.runJudge).mock.calls[0]?.[0];
    expect(call?.userPrompt).toContain("terminal confirmation visible");
    expect(call?.userPrompt).toContain(
      "Earlier workflow view preserved overdue IDs REC-1042 and REC-1077.",
    );
  });

  test("returns null when the verifier has no judge seat (gate skipped)", async () => {
    seedCorpus([]);
    const outcome = await runHighRiskJudgeGate(
      task,
      node,
      { verifyNode: async () => ({ decision: "accept", reason: "", confidence: 1 }) },
      evidence,
      "summary",
    );
    expect(outcome).toBeNull();
  });
});
